import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LeaveBalance } from './entities/leave-balance.entity';
import { BalanceAuditLog } from './entities/balance-audit-log.entity';
import { OptimisticLockError } from '../../common/concurrency/optimistic-lock';

export interface BalanceKey {
  employeeId: string;
  locationId: string;
  leaveType: string;
}

export interface AuditLogInput {
  employeeId: string;
  locationId: string;
  leaveType: string;
  source: string;
  prevHcmBalance?: number | null;
  newHcmBalance?: number | null;
  prevPending?: number | null;
  newPending?: number | null;
  referenceId?: string | null;
}

@Injectable()
export class BalanceRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByKey(
    manager: EntityManager,
    key: BalanceKey,
  ): Promise<LeaveBalance | null> {
    return manager.findOne(LeaveBalance, {
      where: {
        employeeId: key.employeeId,
        locationId: key.locationId,
        leaveType: key.leaveType,
      },
    });
  }

  async findAllByEmployee(employeeId: string): Promise<LeaveBalance[]> {
    return this.dataSource.manager.find(LeaveBalance, {
      where: { employeeId },
    });
  }

  /**
   * Atomically updates hcm_balance to newHcmBalance AND increments pending_days by days.
   * Used during request creation to capture the authoritative HCM balance and reserve days.
   * Throws OptimisticLockError if the version has changed since the row was read.
   */
  async applyHcmRefreshAndIncrementPending(
    manager: EntityManager,
    balance: LeaveBalance,
    newHcmBalance: number,
    days: number,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(LeaveBalance)
      .set({
        hcmBalance: newHcmBalance,
        pendingDays: () => `pending_days + ${days}`,
        version: () => 'version + 1',
        updatedAt: new Date().toISOString(),
      })
      .where('id = :id AND version = :version', {
        id: balance.id,
        version: balance.version,
      })
      .execute();

    if (result.affected === 0) {
      throw new OptimisticLockError();
    }
  }

  /**
   * Decrements pending_days by days. Used when a request is rejected or cancelled (PENDING→REJECTED/CANCELLED).
   */
  async decrementPending(
    manager: EntityManager,
    balance: LeaveBalance,
    days: number,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(LeaveBalance)
      .set({
        pendingDays: () => `pending_days - ${days}`,
        version: () => 'version + 1',
        updatedAt: new Date().toISOString(),
      })
      .where('id = :id AND version = :version', {
        id: balance.id,
        version: balance.version,
      })
      .execute();

    if (result.affected === 0) {
      throw new OptimisticLockError();
    }
  }

  /**
   * Applies approval: hcm_balance decreases by days AND pending_days decreases by days.
   * Net effect on available_days = 0. Used when a manager approves and HCM has deducted.
   */
  async applyApproval(
    manager: EntityManager,
    balance: LeaveBalance,
    days: number,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(LeaveBalance)
      .set({
        hcmBalance: () => `hcm_balance - ${days}`,
        pendingDays: () => `pending_days - ${days}`,
        version: () => 'version + 1',
        updatedAt: new Date().toISOString(),
      })
      .where('id = :id AND version = :version', {
        id: balance.id,
        version: balance.version,
      })
      .execute();

    if (result.affected === 0) {
      throw new OptimisticLockError();
    }
  }

  /**
   * Applies cancellation of an approved request: hcm_balance increases by days (HCM credited back).
   */
  async applyCancellationOfApproved(
    manager: EntityManager,
    balance: LeaveBalance,
    days: number,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(LeaveBalance)
      .set({
        hcmBalance: () => `hcm_balance + ${days}`,
        version: () => 'version + 1',
        updatedAt: new Date().toISOString(),
      })
      .where('id = :id AND version = :version', {
        id: balance.id,
        version: balance.version,
      })
      .execute();

    if (result.affected === 0) {
      throw new OptimisticLockError();
    }
  }

  /**
   * Upserts hcm_balance from a sync payload. Used by batch/single HCM sync.
   * INSERT ... ON CONFLICT DO UPDATE.
   */
  async upsertHcmBalance(
    manager: EntityManager,
    key: BalanceKey,
    newHcmBalance: number,
    syncedAt: string,
  ): Promise<LeaveBalance> {
    const existing = await this.findByKey(manager, key);
    if (existing) {
      const result = await manager
        .createQueryBuilder()
        .update(LeaveBalance)
        .set({
          hcmBalance: newHcmBalance,
          hcmLastSyncedAt: syncedAt,
          version: () => 'version + 1',
          updatedAt: new Date().toISOString(),
        })
        .where('id = :id AND version = :version', {
          id: existing.id,
          version: existing.version,
        })
        .execute();

      if (result.affected === 0) {
        throw new OptimisticLockError();
      }

      return {
        ...existing,
        hcmBalance: newHcmBalance,
        hcmLastSyncedAt: syncedAt,
      };
    } else {
      const newBalance = manager.create(LeaveBalance, {
        id: crypto.randomUUID(),
        employeeId: key.employeeId,
        locationId: key.locationId,
        leaveType: key.leaveType,
        hcmBalance: newHcmBalance,
        pendingDays: 0,
        version: 1,
        hcmLastSyncedAt: syncedAt,
      });
      return manager.save(LeaveBalance, newBalance);
    }
  }

  async writeAuditLog(
    manager: EntityManager,
    input: AuditLogInput,
  ): Promise<void> {
    const log = manager.create(BalanceAuditLog, {
      id: crypto.randomUUID(),
      employeeId: input.employeeId,
      locationId: input.locationId,
      leaveType: input.leaveType,
      source: input.source,
      prevHcmBalance: input.prevHcmBalance ?? null,
      newHcmBalance: input.newHcmBalance ?? null,
      prevPending: input.prevPending ?? null,
      newPending: input.newPending ?? null,
      referenceId: input.referenceId ?? null,
    });
    await manager.save(BalanceAuditLog, log);
  }
}
