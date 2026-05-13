import { DataSource } from 'typeorm';
import { BalanceRepository } from '../../src/modules/balance/balance.repository';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';
import { BalanceAuditLog } from '../../src/modules/balance/entities/balance-audit-log.entity';
import { Employee } from '../../src/modules/balance/entities/employee.entity';
import { Location } from '../../src/modules/balance/entities/location.entity';
import { TimeOffRequest } from '../../src/modules/time-off/entities/time-off-request.entity';
import { OptimisticLockError } from '../../src/common/concurrency/optimistic-lock';

let dataSource: DataSource;
let repo: BalanceRepository;

beforeAll(async () => {
  dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    synchronize: true,
    dropSchema: true,
    entities: [
      LeaveBalance,
      BalanceAuditLog,
      Employee,
      Location,
      TimeOffRequest,
    ],
    prepareDatabase: (db: any) => {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = OFF'); // off for simplicity in unit test
    },
  });
  await dataSource.initialize();
  repo = new BalanceRepository(dataSource);
});

afterAll(async () => {
  await dataSource.destroy();
});

async function seedBalance(): Promise<LeaveBalance> {
  return dataSource.manager.save(LeaveBalance, {
    id: crypto.randomUUID(),
    employeeId: 'EMP-1',
    locationId: 'LOC-1',
    leaveType: 'VACATION',
    hcmBalance: 10,
    pendingDays: 0,
    version: 1,
    hcmLastSyncedAt: null,
  });
}

beforeEach(async () => {
  await dataSource.manager.clear(LeaveBalance);
});

describe('BalanceRepository optimistic locking', () => {
  it('applyHcmRefreshAndIncrementPending succeeds on correct version', async () => {
    const balance = await seedBalance();
    await repo.applyHcmRefreshAndIncrementPending(
      dataSource.manager,
      balance,
      10,
      3,
    );
    const updated = await dataSource.manager.findOneBy(LeaveBalance, {
      id: balance.id,
    });
    expect(updated!.pendingDays).toBe(3);
    expect(updated!.version).toBe(2);
  });

  it('throws OptimisticLockError when version is stale', async () => {
    const balance = await seedBalance();
    // First update changes the version
    await repo.applyHcmRefreshAndIncrementPending(
      dataSource.manager,
      balance,
      10,
      3,
    );
    // Second update with original (stale) version should fail
    await expect(
      repo.applyHcmRefreshAndIncrementPending(
        dataSource.manager,
        balance,
        10,
        2,
      ),
    ).rejects.toThrow(OptimisticLockError);
  });

  it('applyApproval decrements both hcm_balance and pending_days', async () => {
    const balance = await seedBalance();
    await repo.applyHcmRefreshAndIncrementPending(
      dataSource.manager,
      balance,
      10,
      3,
    );
    const afterPending = await dataSource.manager.findOneBy(LeaveBalance, {
      id: balance.id,
    });
    await repo.applyApproval(dataSource.manager, afterPending!, 3);
    const final = await dataSource.manager.findOneBy(LeaveBalance, {
      id: balance.id,
    });
    expect(final!.hcmBalance).toBe(7);
    expect(final!.pendingDays).toBe(0);
    expect(final!.version).toBe(3);
  });

  it('applyCancellationOfApproved increments hcm_balance', async () => {
    const balance = await seedBalance();
    // Simulate an approved state: hcm_balance=7, pending=0
    await dataSource.manager.update(LeaveBalance, balance.id, {
      hcmBalance: 7,
      pendingDays: 0,
      version: 2,
    });
    const approvedBalance = await dataSource.manager.findOneBy(LeaveBalance, {
      id: balance.id,
    });
    await repo.applyCancellationOfApproved(
      dataSource.manager,
      approvedBalance!,
      3,
    );
    const final = await dataSource.manager.findOneBy(LeaveBalance, {
      id: balance.id,
    });
    expect(final!.hcmBalance).toBe(10);
    expect(final!.version).toBe(3);
  });
});
