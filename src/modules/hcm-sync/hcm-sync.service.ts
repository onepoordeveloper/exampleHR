import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BalanceRepository } from '../balance/balance.repository';
import { TimeOffRepository } from '../time-off/time-off.repository';
import { BatchSyncDto } from './dto/batch-sync.dto';
import { SingleSyncDto } from './dto/single-sync.dto';
import { withImmediateTransaction } from '../../database/transaction.helper';
import { retryOnOptimisticLock } from '../../common/concurrency/optimistic-lock';

export interface SyncDiscrepancy {
  employeeId: string;
  locationId: string;
  leaveType: string;
  availableAfterSync: number;
}

@Injectable()
export class HcmSyncService {
  private readonly logger = new Logger(HcmSyncService.name);

  constructor(
    private readonly balanceRepo: BalanceRepository,
    private readonly timeOffRepo: TimeOffRepository,
    private readonly dataSource: DataSource,
  ) {}

  async processBatch(
    payload: BatchSyncDto,
  ): Promise<{ processed: number; discrepanciesFound: number }> {
    const discrepancies: SyncDiscrepancy[] = [];

    for (const entry of payload.balances) {
      const leaveType = entry.leaveType ?? 'VACATION';
      await retryOnOptimisticLock(async () => {
        await withImmediateTransaction(this.dataSource, async (mgr) => {
          const existing = await this.balanceRepo.findByKey(mgr, {
            employeeId: entry.employeeId,
            locationId: entry.locationId,
            leaveType,
          });

          const prevHcm = existing?.hcmBalance ?? null;
          const prevPending = existing?.pendingDays ?? null;

          await this.balanceRepo.upsertHcmBalance(
            mgr,
            {
              employeeId: entry.employeeId,
              locationId: entry.locationId,
              leaveType,
            },
            entry.availableBalance,
            payload.syncedAt,
          );

          // Recompute pending from live DB rows (authoritative)
          const pendingFromDb = await this.timeOffRepo.sumPendingDays(
            mgr,
            entry.employeeId,
            entry.locationId,
            leaveType,
          );

          const availableAfterSync = entry.availableBalance - pendingFromDb;
          if (availableAfterSync < 0) {
            discrepancies.push({
              employeeId: entry.employeeId,
              locationId: entry.locationId,
              leaveType,
              availableAfterSync,
            });
            this.logger.warn(
              `Balance discrepancy detected: employee=${entry.employeeId} location=${entry.locationId} leaveType=${leaveType} availableAfterSync=${availableAfterSync}. ` +
                `HCM balance=${entry.availableBalance}, pending=${pendingFromDb}. ` +
                `Manual review required — requests NOT auto-cancelled.`,
            );
          }

          await this.balanceRepo.writeAuditLog(mgr, {
            employeeId: entry.employeeId,
            locationId: entry.locationId,
            leaveType,
            source: 'BATCH_SYNC',
            prevHcmBalance: prevHcm,
            newHcmBalance: entry.availableBalance,
            prevPending,
            newPending: pendingFromDb,
            referenceId: payload.batchId,
          });
        });
      });
    }

    return {
      processed: payload.balances.length,
      discrepanciesFound: discrepancies.length,
    };
  }

  async processSingle(payload: SingleSyncDto): Promise<void> {
    const leaveType = payload.leaveType ?? 'VACATION';

    await retryOnOptimisticLock(async () => {
      await withImmediateTransaction(this.dataSource, async (mgr) => {
        const existing = await this.balanceRepo.findByKey(mgr, {
          employeeId: payload.employeeId,
          locationId: payload.locationId,
          leaveType,
        });

        const prevHcm = existing?.hcmBalance ?? null;
        const prevPending = existing?.pendingDays ?? null;
        const syncedAt = new Date().toISOString();

        await this.balanceRepo.upsertHcmBalance(
          mgr,
          {
            employeeId: payload.employeeId,
            locationId: payload.locationId,
            leaveType,
          },
          payload.availableBalance,
          syncedAt,
        );

        const pendingFromDb = await this.timeOffRepo.sumPendingDays(
          mgr,
          payload.employeeId,
          payload.locationId,
          leaveType,
        );

        const availableAfterSync = payload.availableBalance - pendingFromDb;
        if (availableAfterSync < 0) {
          this.logger.warn(
            `Single sync discrepancy: employee=${payload.employeeId} location=${payload.locationId} ` +
              `availableAfterSync=${availableAfterSync} reason=${payload.reason ?? 'unknown'}`,
          );
        }

        await this.balanceRepo.writeAuditLog(mgr, {
          employeeId: payload.employeeId,
          locationId: payload.locationId,
          leaveType,
          source: 'REALTIME_SYNC',
          prevHcmBalance: prevHcm,
          newHcmBalance: payload.availableBalance,
          prevPending,
          newPending: pendingFromDb,
          referenceId: payload.reason ?? null,
        });
      });
    });
  }
}
