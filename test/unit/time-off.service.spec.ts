import { Test, TestingModule } from '@nestjs/testing';
import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TimeOffService } from '../../src/modules/time-off/time-off.service';
import { TimeOffRepository } from '../../src/modules/time-off/time-off.repository';
import { BalanceRepository } from '../../src/modules/balance/balance.repository';
import { HcmClientService } from '../../src/modules/hcm-sync/hcm-client.service';
import {
  HcmInsufficientBalanceError,
  HcmUnavailableError,
} from '../../src/modules/hcm-sync/hcm.errors';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';
import {
  TimeOffRequest,
  RequestStatus,
} from '../../src/modules/time-off/entities/time-off-request.entity';

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

function makeRequest(overrides: Partial<TimeOffRequest> = {}): TimeOffRequest {
  const r = new TimeOffRequest();
  r.id = 'REQ-1';
  r.employeeId = 'EMP-1';
  r.locationId = 'LOC-1';
  r.leaveType = 'VACATION';
  r.startDate = '2026-06-01';
  r.endDate = '2026-06-02';
  r.days = 2;
  r.status = RequestStatus.PENDING;
  r.notes = null;
  r.hcmReferenceId = null;
  r.hcmSubmittedAt = null;
  r.idempotencyKey = null;
  r.createdAt = '2026-01-01T00:00:00.000Z';
  r.updatedAt = '2026-01-01T00:00:00.000Z';
  return Object.assign(r, overrides);
}

describe('TimeOffService', () => {
  let service: TimeOffService;
  let timeOffRepo: jest.Mocked<TimeOffRepository>;
  let balanceRepo: jest.Mocked<BalanceRepository>;
  let hcmClient: jest.Mocked<HcmClientService>;

  const mockQr = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {},
  };

  const mockDataSource = {
    manager: {},
    createQueryRunner: jest.fn().mockReturnValue(mockQr),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQr.manager = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffService,
        {
          provide: TimeOffRepository,
          useValue: {
            findById: jest.fn(),
            findByIdempotencyKey: jest.fn(),
            create: jest.fn(),
            updateStatus: jest.fn(),
            list: jest.fn(),
            sumPendingDays: jest.fn(),
          },
        },
        {
          provide: BalanceRepository,
          useValue: {
            findByKey: jest.fn(),
            applyHcmRefreshAndIncrementPending: jest.fn(),
            decrementPending: jest.fn(),
            applyApproval: jest.fn(),
            applyCancellationOfApproved: jest.fn(),
            writeAuditLog: jest.fn(),
          },
        },
        {
          provide: HcmClientService,
          useValue: {
            getBalance: jest.fn(),
            deductBalance: jest.fn(),
            creditBalance: jest.fn(),
          },
        },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(TimeOffService);
    timeOffRepo = module.get(TimeOffRepository);
    balanceRepo = module.get(BalanceRepository);
    hcmClient = module.get(HcmClientService);
  });

  const baseDto = {
    employeeId: 'EMP-1',
    locationId: 'LOC-1',
    leaveType: 'VACATION' as const,
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    days: 2,
  };

  describe('createRequest', () => {
    it('happy path: creates request and returns DTO', async () => {
      hcmClient.getBalance.mockResolvedValue(10);
      timeOffRepo.findByIdempotencyKey.mockResolvedValue(null);
      balanceRepo.findByKey.mockResolvedValue(makeBalance());
      balanceRepo.applyHcmRefreshAndIncrementPending.mockResolvedValue(
        undefined,
      );
      timeOffRepo.create.mockResolvedValue(makeRequest());
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.createRequest(baseDto);
      expect(result.requestId).toBe('REQ-1');
      expect(result.status).toBe(RequestStatus.PENDING);
      expect(
        balanceRepo.applyHcmRefreshAndIncrementPending,
      ).toHaveBeenCalledWith(expect.anything(), expect.any(Object), 10, 2);
    });

    it('rejects when local balance is insufficient', async () => {
      hcmClient.getBalance.mockResolvedValue(1);
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 1, pendingDays: 0 }),
      );

      await expect(
        service.createRequest({ ...baseDto, days: 5 }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when HCM authoritative balance is insufficient', async () => {
      hcmClient.getBalance.mockResolvedValue(1); // HCM says only 1 day
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 10, pendingDays: 0 }),
      ); // stale local

      await expect(
        service.createRequest({ ...baseDto, days: 3 }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns cached response on idempotency key replay', async () => {
      const cached = makeRequest({ id: 'CACHED-REQ' });
      timeOffRepo.findByIdempotencyKey.mockResolvedValue(cached);

      const result = await service.createRequest(baseDto, 'my-key');
      expect(result.requestId).toBe('CACHED-REQ');
      expect(hcmClient.getBalance).not.toHaveBeenCalled();
    });
  });

  describe('approveRequest', () => {
    it('happy path: deducts from HCM and transitions to APPROVED', async () => {
      timeOffRepo.findById
        .mockResolvedValueOnce(makeRequest()) // initial load
        .mockResolvedValueOnce(makeRequest({ id: 'REQ-1' })) // re-read inside txn
        .mockResolvedValueOnce(makeRequest({ status: RequestStatus.APPROVED })); // final read
      balanceRepo.findByKey.mockResolvedValue(makeBalance());
      hcmClient.deductBalance.mockResolvedValue('HCM-REF-1');
      balanceRepo.applyApproval.mockResolvedValue(undefined);
      timeOffRepo.updateStatus.mockResolvedValue(undefined);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.approveRequest('REQ-1');
      expect(hcmClient.deductBalance).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(RequestStatus.APPROVED);
    });

    it('returns 409 when HCM returns 422 (insufficient balance)', async () => {
      timeOffRepo.findById.mockResolvedValue(makeRequest());
      hcmClient.deductBalance.mockRejectedValue(
        new HcmInsufficientBalanceError(),
      );

      await expect(service.approveRequest('REQ-1')).rejects.toThrow(
        ConflictException,
      );
      expect(balanceRepo.applyApproval).not.toHaveBeenCalled();
    });

    it('returns 502 when HCM is unavailable and leaves request PENDING', async () => {
      timeOffRepo.findById.mockResolvedValue(makeRequest());
      hcmClient.deductBalance.mockRejectedValue(new HcmUnavailableError());

      await expect(service.approveRequest('REQ-1')).rejects.toThrow(
        BadGatewayException,
      );
      expect(balanceRepo.applyApproval).not.toHaveBeenCalled();
      expect(timeOffRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('cancelRequest', () => {
    it('cancels PENDING request and releases pending_days', async () => {
      timeOffRepo.findById
        .mockResolvedValueOnce(makeRequest())
        .mockResolvedValueOnce(
          makeRequest({ status: RequestStatus.CANCELLED }),
        );
      balanceRepo.findByKey.mockResolvedValue(makeBalance({ pendingDays: 2 }));
      balanceRepo.decrementPending.mockResolvedValue(undefined);
      timeOffRepo.updateStatus.mockResolvedValue(undefined);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.cancelRequest('REQ-1');
      expect(balanceRepo.decrementPending).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Object),
        2,
      );
      expect(hcmClient.creditBalance).not.toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.CANCELLED);
    });

    it('cancels APPROVED request and calls HCM credit exactly once', async () => {
      const approvedReq = makeRequest({
        status: RequestStatus.APPROVED,
        hcmReferenceId: 'HCM-REF-1',
      });
      timeOffRepo.findById
        .mockResolvedValueOnce(approvedReq)
        .mockResolvedValueOnce(
          makeRequest({ status: RequestStatus.CANCELLED }),
        );
      hcmClient.creditBalance.mockResolvedValue(undefined);
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 8, pendingDays: 0 }),
      );
      balanceRepo.applyCancellationOfApproved.mockResolvedValue(undefined);
      timeOffRepo.updateStatus.mockResolvedValue(undefined);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.cancelRequest('REQ-1');
      expect(hcmClient.creditBalance).toHaveBeenCalledTimes(1);
      expect(hcmClient.creditBalance).toHaveBeenCalledWith(
        'EMP-1',
        'LOC-1',
        'VACATION',
        2,
        'HCM-REF-1',
      );
      expect(result.status).toBe(RequestStatus.CANCELLED);
    });

    it('throws ConflictException for terminal statuses', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.REJECTED }),
      );
      await expect(service.cancelRequest('REQ-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException for COMPLETED status', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.COMPLETED }),
      );
      await expect(service.cancelRequest('REQ-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException for CANCELLED status', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.CANCELLED }),
      );
      await expect(service.cancelRequest('REQ-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when request not found', async () => {
      timeOffRepo.findById.mockResolvedValue(null);
      await expect(service.cancelRequest('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadGatewayException when HCM credit fails on APPROVED cancel', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.APPROVED }),
      );
      hcmClient.creditBalance.mockRejectedValue(new HcmUnavailableError());
      await expect(service.cancelRequest('REQ-1')).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('re-throws non-HCM errors on APPROVED cancel', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.APPROVED }),
      );
      hcmClient.creditBalance.mockRejectedValue(new Error('unexpected'));
      await expect(service.cancelRequest('REQ-1')).rejects.toThrow(
        'unexpected',
      );
    });
  });

  describe('listRequests', () => {
    it('returns paginated results with defaults', async () => {
      const req = makeRequest();
      timeOffRepo.list.mockResolvedValue({ rows: [req], total: 1 });
      const result = await service.listRequests({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('returns page=1, limit=20 when query has no page/limit', async () => {
      timeOffRepo.list.mockResolvedValue({ rows: [], total: 0 });
      const result = await service.listRequests({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('getRequest', () => {
    it('returns DTO for found request', async () => {
      timeOffRepo.findById.mockResolvedValue(makeRequest());
      const result = await service.getRequest('REQ-1');
      expect(result.requestId).toBe('REQ-1');
    });

    it('throws NotFoundException for unknown id', async () => {
      timeOffRepo.findById.mockResolvedValue(null);
      await expect(service.getRequest('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('rejectRequest', () => {
    it('throws NotFoundException when request not found', async () => {
      timeOffRepo.findById.mockResolvedValue(null);
      await expect(service.rejectRequest('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when request is not PENDING', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.APPROVED }),
      );
      await expect(service.rejectRequest('REQ-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('happy path: rejects PENDING request, decrements pending_days, with reason', async () => {
      timeOffRepo.findById
        .mockResolvedValueOnce(makeRequest())
        .mockResolvedValueOnce(makeRequest({ status: RequestStatus.REJECTED }));
      balanceRepo.findByKey.mockResolvedValue(makeBalance({ pendingDays: 2 }));
      balanceRepo.decrementPending.mockResolvedValue(undefined);
      timeOffRepo.updateStatus.mockResolvedValue(undefined);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.rejectRequest('REQ-1', 'Not approved');
      expect(balanceRepo.decrementPending).toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.REJECTED);
    });

    it('rejects without reason (no appended message)', async () => {
      timeOffRepo.findById
        .mockResolvedValueOnce(makeRequest({ notes: 'original note' }))
        .mockResolvedValueOnce(makeRequest({ status: RequestStatus.REJECTED }));
      balanceRepo.findByKey.mockResolvedValue(makeBalance({ pendingDays: 2 }));
      balanceRepo.decrementPending.mockResolvedValue(undefined);
      timeOffRepo.updateStatus.mockResolvedValue(undefined);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.rejectRequest('REQ-1');
      expect(result.status).toBe(RequestStatus.REJECTED);
    });
  });

  describe('completeRequest', () => {
    it('throws NotFoundException when not found', async () => {
      timeOffRepo.findById.mockResolvedValue(null);
      await expect(service.completeRequest('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when not APPROVED', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.PENDING }),
      );
      await expect(service.completeRequest('REQ-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('completes APPROVED request', async () => {
      timeOffRepo.findById
        .mockResolvedValueOnce(makeRequest({ status: RequestStatus.APPROVED }))
        .mockResolvedValueOnce(
          makeRequest({ status: RequestStatus.COMPLETED }),
        );
      timeOffRepo.updateStatus.mockResolvedValue(undefined);

      const result = await service.completeRequest('REQ-1');
      expect(result.status).toBe(RequestStatus.COMPLETED);
    });
  });

  describe('createRequest - HCM unavailable fallback', () => {
    it('uses local shadow when HCM is unavailable for balance check', async () => {
      hcmClient.getBalance.mockRejectedValue(new HcmUnavailableError());
      timeOffRepo.findByIdempotencyKey.mockResolvedValue(null);
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 10, pendingDays: 0 }),
      );
      balanceRepo.applyHcmRefreshAndIncrementPending.mockResolvedValue(
        undefined,
      );
      timeOffRepo.create.mockResolvedValue(makeRequest());
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.createRequest(baseDto);
      expect(result.requestId).toBe('REQ-1');
    });

    it('re-throws non-HcmUnavailable errors from getBalance', async () => {
      hcmClient.getBalance.mockRejectedValue(new Error('network timeout'));
      timeOffRepo.findByIdempotencyKey.mockResolvedValue(null);
      await expect(service.createRequest(baseDto)).rejects.toThrow(
        'network timeout',
      );
    });

    it('UNIQUE constraint idempotency catch path returns cached row', async () => {
      hcmClient.getBalance.mockResolvedValue(10);
      timeOffRepo.findByIdempotencyKey.mockResolvedValue(null); // no cached initially (outside txn)
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 10, pendingDays: 0 }),
      );
      balanceRepo.applyHcmRefreshAndIncrementPending.mockResolvedValue(
        undefined,
      );
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const uniqueErr = new Error(
        'UNIQUE constraint failed: time_off_requests.idempotency_key',
      );
      const cachedReq = makeRequest({ id: 'CACHED-FROM-CONSTRAINT' });
      timeOffRepo.create.mockRejectedValue(uniqueErr);
      // Inside txn: findByIdempotencyKey finds the race-winner row
      timeOffRepo.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cachedReq);

      const result = await service.createRequest(baseDto, 'race-key');
      expect(result.requestId).toBe('CACHED-FROM-CONSTRAINT');
    });
  });

  describe('approveRequest - edge cases', () => {
    it('throws NotFoundException when request not found', async () => {
      timeOffRepo.findById.mockResolvedValue(null);
      await expect(service.approveRequest('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when request is not PENDING', async () => {
      timeOffRepo.findById.mockResolvedValue(
        makeRequest({ status: RequestStatus.APPROVED }),
      );
      await expect(service.approveRequest('REQ-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('re-throws unknown HCM errors during deductBalance', async () => {
      timeOffRepo.findById.mockResolvedValue(makeRequest());
      hcmClient.deductBalance.mockRejectedValue(
        new Error('unexpected hcm error'),
      );
      await expect(service.approveRequest('REQ-1')).rejects.toThrow(
        'unexpected hcm error',
      );
    });

    it('is idempotent when request status changes during approval transaction', async () => {
      // First findById returns PENDING (before HCM call)
      // Second findById (inside txn) returns non-PENDING (already approved)
      timeOffRepo.findById
        .mockResolvedValueOnce(makeRequest()) // outer check — PENDING
        .mockResolvedValueOnce(makeRequest({ status: RequestStatus.APPROVED })) // inner re-read — already APPROVED
        .mockResolvedValueOnce(makeRequest({ status: RequestStatus.APPROVED })); // final read

      hcmClient.deductBalance.mockResolvedValue('HCM-REF-2');
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.approveRequest('REQ-1');
      // Should not throw — idempotent path logs warning and returns
      expect(result.status).toBe(RequestStatus.APPROVED);
      expect(balanceRepo.applyApproval).not.toHaveBeenCalled();
    });
  });
});
