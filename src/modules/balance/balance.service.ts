import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BalanceRepository } from './balance.repository';
import { HcmClientService } from '../hcm-sync/hcm-client.service';
import { BalanceResponseDto } from './dto/balance-response.dto';
import { LeaveBalance } from './entities/leave-balance.entity';
import { withImmediateTransaction } from '../../database/transaction.helper';
import { retryOnOptimisticLock } from '../../common/concurrency/optimistic-lock';

@Injectable()
export class BalanceService {
  constructor(
    private readonly balanceRepo: BalanceRepository,
    private readonly hcmClient: HcmClientService,
    private readonly dataSource: DataSource,
  ) {}

  async listByEmployee(employeeId: string): Promise<BalanceResponseDto[]> {
    const rows = await this.balanceRepo.findAllByEmployee(employeeId);
    return rows.map((r) => this.toDto(r));
  }

  async getOne(
    employeeId: string,
    locationId: string,
    leaveType = 'VACATION',
  ): Promise<BalanceResponseDto> {
    const row = await this.balanceRepo.findByKey(this.dataSource.manager, {
      employeeId,
      locationId,
      leaveType,
    });
    if (!row)
      throw new NotFoundException(
        'Balance not found for the given employee/location/leaveType',
      );
    return this.toDto(row);
  }

  async refresh(
    employeeId: string,
    locationId: string,
    leaveType = 'VACATION',
  ): Promise<BalanceResponseDto> {
    const hcmBalance = await this.hcmClient.getBalance(
      employeeId,
      locationId,
      leaveType,
    );
    const syncedAt = new Date().toISOString();

    let updated: LeaveBalance | null = null;
    await retryOnOptimisticLock(async () => {
      await withImmediateTransaction(this.dataSource, async (mgr) => {
        const existing = await this.balanceRepo.findByKey(mgr, {
          employeeId,
          locationId,
          leaveType,
        });
        const prev = existing ?? null;
        updated = await this.balanceRepo.upsertHcmBalance(
          mgr,
          { employeeId, locationId, leaveType },
          hcmBalance,
          syncedAt,
        );
        await this.balanceRepo.writeAuditLog(mgr, {
          employeeId,
          locationId,
          leaveType,
          source: 'REALTIME_SYNC',
          prevHcmBalance: prev?.hcmBalance ?? null,
          newHcmBalance: hcmBalance,
          prevPending: prev?.pendingDays ?? null,
          newPending: updated?.pendingDays ?? 0,
        });
      });
    });

    if (!updated) {
      return this.getOne(employeeId, locationId, leaveType);
    }
    return this.toDto(updated);
  }

  private toDto(row: LeaveBalance): BalanceResponseDto {
    return {
      locationId: row.locationId,
      leaveType: row.leaveType,
      hcmBalance: row.hcmBalance,
      pendingDays: row.pendingDays,
      availableDays: row.hcmBalance - row.pendingDays,
      lastSyncedAt: row.hcmLastSyncedAt,
    };
  }
}
