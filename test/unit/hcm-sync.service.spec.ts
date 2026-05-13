import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HcmSyncService } from '../../src/modules/hcm-sync/hcm-sync.service';
import { BalanceRepository } from '../../src/modules/balance/balance.repository';
import { TimeOffRepository } from '../../src/modules/time-off/time-off.repository';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';

jest.mock('../../src/database/transaction.helper', () => ({
  withImmediateTransaction: jest
    .fn()
    .mockImplementation(async (_ds: any, fn: (m: any) => Promise<any>) =>
      fn({}),
    ),
}));

function makeBalance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  const b = new LeaveBalance();
  b.id = 'BAL-1';
  b.employeeId = 'EMP-1';
  b.locationId = 'LOC-1';
  b.leaveType = 'VACATION';
  b.hcmBalance = 10;
  b.pendingDays = 0;
  b.version = 1;
  b.hcmLastSyncedAt = null;
  return Object.assign(b, overrides);
}

describe('HcmSyncService', () => {
  let service: HcmSyncService;
  let balanceRepo: jest.Mocked<BalanceRepository>;
  let timeOffRepo: jest.Mocked<TimeOffRepository>;

  const mockQr = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {},
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmSyncService,
        {
          provide: BalanceRepository,
          useValue: {
            findByKey: jest.fn(),
            upsertHcmBalance: jest.fn(),
            writeAuditLog: jest.fn(),
          },
        },
        {
          provide: TimeOffRepository,
          useValue: {
            sumPendingDays: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            manager: {},
            createQueryRunner: jest.fn().mockReturnValue(mockQr),
          },
        },
      ],
    }).compile();

    service = module.get(HcmSyncService);
    balanceRepo = module.get(BalanceRepository);
    timeOffRepo = module.get(TimeOffRepository);
  });

  describe('processBatch', () => {
    it('upserts balance and writes audit log for each entry', async () => {
      balanceRepo.findByKey.mockResolvedValue(makeBalance({ hcmBalance: 5 }));
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({ hcmBalance: 10 }),
      );
      timeOffRepo.sumPendingDays.mockResolvedValue(0);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.processBatch({
        batchId: crypto.randomUUID(),
        syncedAt: '2026-05-11T08:00:00Z',
        balances: [
          { employeeId: 'EMP-1', locationId: 'LOC-1', availableBalance: 10 },
        ],
      });

      expect(result.processed).toBe(1);
      expect(result.discrepanciesFound).toBe(0);
      expect(balanceRepo.upsertHcmBalance).toHaveBeenCalledWith(
        expect.anything(),
        { employeeId: 'EMP-1', locationId: 'LOC-1', leaveType: 'VACATION' },
        10,
        '2026-05-11T08:00:00Z',
      );
      expect(balanceRepo.writeAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ source: 'BATCH_SYNC', newHcmBalance: 10 }),
      );
    });

    it('detects discrepancy when availableBalance < pendingFromDb (anniversary bonus context)', async () => {
      // HCM sends anniversary bonus: balance goes from 5 to 15
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 5, pendingDays: 3 }),
      );
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({ hcmBalance: 15 }),
      );
      timeOffRepo.sumPendingDays.mockResolvedValue(0); // no pending after sync
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.processBatch({
        batchId: crypto.randomUUID(),
        syncedAt: '2026-05-11T08:00:00Z',
        balances: [
          { employeeId: 'EMP-1', locationId: 'LOC-1', availableBalance: 15 },
        ],
      });

      expect(result.discrepanciesFound).toBe(0); // 15 - 0 pending = 15, not negative
      expect(result.processed).toBe(1);
    });

    it('logs WARN and reports discrepancy when available goes negative', async () => {
      // HCM sends 2 days but we have 5 days pending — discrepancy
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 10, pendingDays: 5 }),
      );
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({ hcmBalance: 2 }),
      );
      timeOffRepo.sumPendingDays.mockResolvedValue(5); // still 5 days pending in DB
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.processBatch({
        batchId: crypto.randomUUID(),
        syncedAt: '2026-05-11T08:00:00Z',
        balances: [
          { employeeId: 'EMP-1', locationId: 'LOC-1', availableBalance: 2 },
        ],
      });

      expect(result.discrepanciesFound).toBe(1);
      expect(result.processed).toBe(1);
    });

    it('upserts new balance row when employee/location not found', async () => {
      balanceRepo.findByKey.mockResolvedValue(null); // not found
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({ hcmBalance: 7 }),
      );
      timeOffRepo.sumPendingDays.mockResolvedValue(0);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.processBatch({
        batchId: crypto.randomUUID(),
        syncedAt: '2026-05-11T08:00:00Z',
        balances: [
          { employeeId: 'NEW-EMP', locationId: 'NEW-LOC', availableBalance: 7 },
        ],
      });

      expect(result.processed).toBe(1);
      expect(balanceRepo.upsertHcmBalance).toHaveBeenCalled();
    });
  });

  describe('processSingle', () => {
    it('updates balance and writes audit log', async () => {
      balanceRepo.findByKey.mockResolvedValue(makeBalance({ hcmBalance: 5 }));
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({ hcmBalance: 10 }),
      );
      timeOffRepo.sumPendingDays.mockResolvedValue(0);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      await expect(
        service.processSingle({
          employeeId: 'EMP-1',
          locationId: 'LOC-1',
          availableBalance: 10,
          reason: 'ANNIVERSARY_BONUS',
        }),
      ).resolves.toBeUndefined();

      expect(balanceRepo.writeAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ source: 'REALTIME_SYNC', newHcmBalance: 10 }),
      );
    });

    it('logs warning when availableAfterSync goes negative (discrepancy)', async () => {
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 10, pendingDays: 5 }),
      );
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({ hcmBalance: 1 }),
      );
      timeOffRepo.sumPendingDays.mockResolvedValue(5); // still 5 days pending in DB
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      // Should not throw — just log a warning
      await expect(
        service.processSingle({
          employeeId: 'EMP-1',
          locationId: 'LOC-1',
          availableBalance: 1,
          reason: 'MANUAL_CORRECTION',
        }),
      ).resolves.toBeUndefined();

      expect(balanceRepo.writeAuditLog).toHaveBeenCalled();
    });

    it('handles missing existing balance row (null)', async () => {
      balanceRepo.findByKey.mockResolvedValue(null);
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({ hcmBalance: 7 }),
      );
      timeOffRepo.sumPendingDays.mockResolvedValue(0);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      await expect(
        service.processSingle({
          employeeId: 'NEW-EMP',
          locationId: 'NEW-LOC',
          availableBalance: 7,
          reason: 'INITIAL_LOAD',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
