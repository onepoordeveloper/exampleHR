import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TimeOffRepository } from './time-off.repository';
import { BalanceRepository } from '../balance/balance.repository';
import { HcmClientService } from '../hcm-sync/hcm-client.service';
import {
  HcmInsufficientBalanceError,
  HcmUnavailableError,
} from '../hcm-sync/hcm.errors';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto';
import { TimeOffResponseDto } from './dto/time-off-response.dto';
import {
  TimeOffRequest,
  RequestStatus,
} from './entities/time-off-request.entity';
import { withImmediateTransaction } from '../../database/transaction.helper';
import { retryOnOptimisticLock } from '../../common/concurrency/optimistic-lock';

@Injectable()
export class TimeOffService {
  private readonly logger = new Logger(TimeOffService.name);

  constructor(
    private readonly timeOffRepo: TimeOffRepository,
    private readonly balanceRepo: BalanceRepository,
    private readonly hcmClient: HcmClientService,
    private readonly dataSource: DataSource,
  ) {}

  async createRequest(
    dto: CreateTimeOffRequestDto,
    idempotencyKey?: string,
  ): Promise<TimeOffResponseDto> {
    const leaveType = dto.leaveType ?? 'VACATION';

    // Idempotency check (outside transaction — safe because DB has UNIQUE constraint)
    if (idempotencyKey) {
      const cached = await this.timeOffRepo.findByIdempotencyKey(
        this.dataSource.manager,
        idempotencyKey,
      );
      if (cached) return this.toDto(cached);
    }

    // HCM real-time balance call OUTSIDE transaction (avoid holding write lock during network IO)
    let hcmAvailable: number;
    try {
      hcmAvailable = await this.hcmClient.getBalance(
        dto.employeeId,
        dto.locationId,
        leaveType,
      );
    } catch (err) {
      if (err instanceof HcmUnavailableError) {
        this.logger.warn(
          'HCM unavailable for balance check, using local shadow',
        );
        hcmAvailable = -1; // sentinel: will use local check only
      } else {
        throw err;
      }
    }

    let created: TimeOffRequest | null = null;
    await retryOnOptimisticLock(async () => {
      await withImmediateTransaction(this.dataSource, async (mgr) => {
        const balance = await this.balanceRepo.findByKey(mgr, {
          employeeId: dto.employeeId,
          locationId: dto.locationId,
          leaveType,
        });

        if (!balance) {
          throw new NotFoundException(
            `No leave balance found for employee ${dto.employeeId} at location ${dto.locationId}`,
          );
        }

        // Defensive local check first
        const localAvailable = balance.hcmBalance - balance.pendingDays;
        if (localAvailable < dto.days) {
          throw new ConflictException(
            `Insufficient balance: ${localAvailable} days available, ${dto.days} requested`,
          );
        }

        // Use authoritative HCM balance if available
        const effectiveHcm =
          hcmAvailable >= 0 ? hcmAvailable : balance.hcmBalance;
        const authoritativeAvailable = effectiveHcm - balance.pendingDays;
        if (authoritativeAvailable < dto.days) {
          throw new ConflictException(
            `Insufficient balance (HCM authoritative): ${authoritativeAvailable} days available, ${dto.days} requested`,
          );
        }

        const prevHcm = balance.hcmBalance;
        const prevPending = balance.pendingDays;

        // Atomic: update hcm_balance to authoritative value AND increment pending_days
        // Throws OptimisticLockError if version changed → triggers retry
        await this.balanceRepo.applyHcmRefreshAndIncrementPending(
          mgr,
          balance,
          effectiveHcm,
          dto.days,
        );

        const requestId = crypto.randomUUID();
        try {
          created = await this.timeOffRepo.create(mgr, {
            id: requestId,
            employeeId: dto.employeeId,
            locationId: dto.locationId,
            leaveType,
            startDate: dto.startDate,
            endDate: dto.endDate,
            days: dto.days,
            status: RequestStatus.PENDING,
            notes: dto.notes ?? null,
            idempotencyKey: idempotencyKey ?? null,
          });
        } catch (err: unknown) {
          // Handle idempotency_key UNIQUE constraint race
          if (
            err instanceof Error &&
            err.message.includes('UNIQUE') &&
            idempotencyKey
          ) {
            const cached = await this.timeOffRepo.findByIdempotencyKey(
              mgr,
              idempotencyKey,
            );
            if (cached) {
              created = cached;
              return;
            }
          }
          throw err;
        }

        await this.balanceRepo.writeAuditLog(mgr, {
          employeeId: dto.employeeId,
          locationId: dto.locationId,
          leaveType,
          source: 'REQUEST_CREATED',
          prevHcmBalance: prevHcm,
          newHcmBalance: effectiveHcm,
          prevPending,
          newPending: prevPending + dto.days,
          referenceId: requestId,
        });
      });
    });

    return this.toDto(created!);
  }

  async getRequest(id: string): Promise<TimeOffResponseDto> {
    const req = await this.timeOffRepo.findById(this.dataSource.manager, id);
    if (!req) throw new NotFoundException(`Request ${id} not found`);
    return this.toDto(req);
  }

  async listRequests(query: ListRequestsQueryDto): Promise<{
    data: TimeOffResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { rows, total } = await this.timeOffRepo.list(query);
    return {
      data: rows.map((r) => this.toDto(r)),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async approveRequest(requestId: string): Promise<TimeOffResponseDto> {
    const request = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    if (!request) throw new NotFoundException(`Request ${requestId} not found`);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(
        `Request is ${request.status}, only PENDING requests can be approved`,
      );
    }

    // Call HCM BEFORE the transaction — do not hold the write lock during network IO
    let hcmRefId: string;
    try {
      hcmRefId = await this.hcmClient.deductBalance(
        request.employeeId,
        request.locationId,
        request.leaveType,
        request.days,
      );
    } catch (err) {
      if (err instanceof HcmInsufficientBalanceError) {
        throw new ConflictException(
          'HCM rejected approval: insufficient balance in HCM',
        );
      }
      if (err instanceof HcmUnavailableError) {
        throw new BadGatewayException(
          'HCM is unavailable. Please retry the approval.',
        );
      }
      throw err;
    }

    const hcmSubmittedAt = new Date().toISOString();

    await retryOnOptimisticLock(async () => {
      await withImmediateTransaction(this.dataSource, async (mgr) => {
        // Re-read for defensive check (manager could double-click approve)
        const freshReq = await this.timeOffRepo.findById(mgr, requestId);
        if (!freshReq || freshReq.status !== RequestStatus.PENDING) {
          this.logger.warn(
            `Request ${requestId} status changed while approving; HCM ref: ${hcmRefId}`,
          );
          return; // idempotent — already approved
        }

        const balance = await this.balanceRepo.findByKey(mgr, {
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
        });
        if (!balance)
          throw new NotFoundException('Balance not found during approval');

        const prevHcm = balance.hcmBalance;
        const prevPending = balance.pendingDays;

        await this.balanceRepo.applyApproval(mgr, balance, request.days);
        await this.timeOffRepo.updateStatus(mgr, requestId, {
          status: RequestStatus.APPROVED,
          hcmReferenceId: hcmRefId,
          hcmSubmittedAt,
        });
        await this.balanceRepo.writeAuditLog(mgr, {
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
          source: 'REQUEST_APPROVED',
          prevHcmBalance: prevHcm,
          newHcmBalance: prevHcm - request.days,
          prevPending,
          newPending: prevPending - request.days,
          referenceId: requestId,
        });
      });
    });

    const updated = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    return this.toDto(updated!);
  }

  async rejectRequest(
    requestId: string,
    reason?: string,
  ): Promise<TimeOffResponseDto> {
    const request = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    if (!request) throw new NotFoundException(`Request ${requestId} not found`);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(
        `Request is ${request.status}, only PENDING requests can be rejected`,
      );
    }

    await retryOnOptimisticLock(async () => {
      await withImmediateTransaction(this.dataSource, async (mgr) => {
        const balance = await this.balanceRepo.findByKey(mgr, {
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
        });
        if (!balance)
          throw new NotFoundException('Balance not found during rejection');

        const prevPending = balance.pendingDays;
        await this.balanceRepo.decrementPending(mgr, balance, request.days);
        await this.timeOffRepo.updateStatus(mgr, requestId, {
          status: RequestStatus.REJECTED,
          notes: reason
            ? `${request.notes ?? ''}\nRejection reason: ${reason}`.trim()
            : request.notes,
        });
        await this.balanceRepo.writeAuditLog(mgr, {
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
          source: 'REQUEST_REJECTED',
          prevHcmBalance: balance.hcmBalance,
          newHcmBalance: balance.hcmBalance,
          prevPending,
          newPending: prevPending - request.days,
          referenceId: requestId,
        });
      });
    });

    const updated = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    return this.toDto(updated!);
  }

  async cancelRequest(requestId: string): Promise<TimeOffResponseDto> {
    const request = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    if (!request) throw new NotFoundException(`Request ${requestId} not found`);

    if (
      request.status === RequestStatus.REJECTED ||
      request.status === RequestStatus.COMPLETED ||
      request.status === RequestStatus.CANCELLED
    ) {
      throw new ConflictException(
        `Cannot cancel a request with status ${request.status}`,
      );
    }

    if (request.status === RequestStatus.PENDING) {
      // Cancel PENDING: just release the local reservation
      await retryOnOptimisticLock(async () => {
        await withImmediateTransaction(this.dataSource, async (mgr) => {
          const balance = await this.balanceRepo.findByKey(mgr, {
            employeeId: request.employeeId,
            locationId: request.locationId,
            leaveType: request.leaveType,
          });
          if (!balance)
            throw new NotFoundException(
              'Balance not found during cancellation',
            );

          const prevPending = balance.pendingDays;
          await this.balanceRepo.decrementPending(mgr, balance, request.days);
          await this.timeOffRepo.updateStatus(mgr, requestId, {
            status: RequestStatus.CANCELLED,
          });
          await this.balanceRepo.writeAuditLog(mgr, {
            employeeId: request.employeeId,
            locationId: request.locationId,
            leaveType: request.leaveType,
            source: 'REQUEST_CANCELLED',
            prevHcmBalance: balance.hcmBalance,
            newHcmBalance: balance.hcmBalance,
            prevPending,
            newPending: prevPending - request.days,
            referenceId: requestId,
          });
        });
      });
    } else if (request.status === RequestStatus.APPROVED) {
      // Cancel APPROVED: call HCM credit first
      try {
        await this.hcmClient.creditBalance(
          request.employeeId,
          request.locationId,
          request.leaveType,
          request.days,
          request.hcmReferenceId ?? undefined,
        );
      } catch (err) {
        if (err instanceof HcmUnavailableError) {
          throw new BadGatewayException(
            'HCM is unavailable. Please retry the cancellation.',
          );
        }
        throw err;
      }

      await retryOnOptimisticLock(async () => {
        await withImmediateTransaction(this.dataSource, async (mgr) => {
          const balance = await this.balanceRepo.findByKey(mgr, {
            employeeId: request.employeeId,
            locationId: request.locationId,
            leaveType: request.leaveType,
          });
          if (!balance)
            throw new NotFoundException(
              'Balance not found during approval cancellation',
            );

          const prevHcm = balance.hcmBalance;
          await this.balanceRepo.applyCancellationOfApproved(
            mgr,
            balance,
            request.days,
          );
          await this.timeOffRepo.updateStatus(mgr, requestId, {
            status: RequestStatus.CANCELLED,
          });
          await this.balanceRepo.writeAuditLog(mgr, {
            employeeId: request.employeeId,
            locationId: request.locationId,
            leaveType: request.leaveType,
            source: 'REQUEST_CANCELLED',
            prevHcmBalance: prevHcm,
            newHcmBalance: prevHcm + request.days,
            prevPending: balance.pendingDays,
            newPending: balance.pendingDays,
            referenceId: requestId,
          });
        });
      });
    }

    const updated = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    return this.toDto(updated!);
  }

  async completeRequest(requestId: string): Promise<TimeOffResponseDto> {
    const request = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    if (!request) throw new NotFoundException(`Request ${requestId} not found`);
    if (request.status !== RequestStatus.APPROVED) {
      throw new ConflictException(
        `Request is ${request.status}, only APPROVED requests can be completed`,
      );
    }
    await this.timeOffRepo.updateStatus(this.dataSource.manager, requestId, {
      status: RequestStatus.COMPLETED,
    });
    const updated = await this.timeOffRepo.findById(
      this.dataSource.manager,
      requestId,
    );
    return this.toDto(updated!);
  }

  private toDto(req: TimeOffRequest): TimeOffResponseDto {
    return {
      requestId: req.id,
      employeeId: req.employeeId,
      locationId: req.locationId,
      leaveType: req.leaveType,
      startDate: req.startDate,
      endDate: req.endDate,
      days: req.days,
      status: req.status,
      notes: req.notes,
      hcmReferenceId: req.hcmReferenceId,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
    };
  }
}
