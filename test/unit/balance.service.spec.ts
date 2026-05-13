import { Test, TestingModule } from '@nestjs/testing';
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { of } from 'rxjs';
import { BalanceService } from '../../src/modules/balance/balance.service';
import { BalanceRepository } from '../../src/modules/balance/balance.repository';
import { HcmClientService } from '../../src/modules/hcm-sync/hcm-client.service';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { HcmApiKeyGuard } from '../../src/common/guards/hcm-api-key.guard';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import {
  OptimisticLockError,
  retryOnOptimisticLock,
} from '../../src/common/concurrency/optimistic-lock';
import {
  HcmInsufficientBalanceError,
  HcmInvalidDimensionsError,
  HcmUnavailableError,
} from '../../src/modules/hcm-sync/hcm.errors';

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

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepo: jest.Mocked<BalanceRepository>;
  let hcmClient: jest.Mocked<HcmClientService>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    const mockRepo: Partial<jest.Mocked<BalanceRepository>> = {
      findAllByEmployee: jest.fn(),
      findByKey: jest.fn(),
      upsertHcmBalance: jest.fn(),
      writeAuditLog: jest.fn(),
    };
    const mockHcm: Partial<jest.Mocked<HcmClientService>> = {
      getBalance: jest.fn(),
    };
    const mockDs = {
      manager: {},
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        query: jest.fn(),
        release: jest.fn(),
        manager: {},
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        { provide: BalanceRepository, useValue: mockRepo },
        { provide: HcmClientService, useValue: mockHcm },
        { provide: DataSource, useValue: mockDs },
      ],
    }).compile();

    service = module.get(BalanceService);
    balanceRepo = module.get(BalanceRepository);
    hcmClient = module.get(HcmClientService);
    dataSource = module.get(DataSource);
  });

  describe('listByEmployee', () => {
    it('returns DTOs with computed availableDays', async () => {
      balanceRepo.findAllByEmployee.mockResolvedValue([
        makeBalance({ hcmBalance: 10, pendingDays: 3 }),
      ]);
      const result = await service.listByEmployee('EMP-1');
      expect(result).toHaveLength(1);
      expect(result[0].availableDays).toBe(7);
      expect(result[0].hcmBalance).toBe(10);
      expect(result[0].pendingDays).toBe(3);
    });
  });

  describe('getOne', () => {
    it('returns DTO for found balance', async () => {
      balanceRepo.findByKey.mockResolvedValue(
        makeBalance({ hcmBalance: 8, pendingDays: 2 }),
      );
      const result = await service.getOne('EMP-1', 'LOC-1', 'VACATION');
      expect(result.availableDays).toBe(6);
    });

    it('throws NotFoundException when balance not found', async () => {
      balanceRepo.findByKey.mockResolvedValue(null);
      await expect(
        service.getOne('EMP-1', 'LOC-1', 'VACATION'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('refresh', () => {
    it('calls HCM, upserts balance, writes audit log, returns DTO', async () => {
      hcmClient.getBalance.mockResolvedValue(12);
      balanceRepo.findByKey.mockResolvedValue(makeBalance({ hcmBalance: 10 }));
      balanceRepo.upsertHcmBalance.mockResolvedValue(
        makeBalance({
          hcmBalance: 12,
          hcmLastSyncedAt: '2026-01-01T00:00:00.000Z',
        }),
      );
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      // mock the transaction
      const qr = (dataSource as any).createQueryRunner();
      qr.query.mockResolvedValue(undefined);

      const result = await service.refresh('EMP-1', 'LOC-1', 'VACATION');
      expect(hcmClient.getBalance).toHaveBeenCalledWith(
        'EMP-1',
        'LOC-1',
        'VACATION',
      );
      expect(result.hcmBalance).toBe(12);
    });

    it('falls back to getOne when updated is null', async () => {
      hcmClient.getBalance.mockResolvedValue(12);
      // upsertHcmBalance returns null-ish — simulate by making the transaction not set updated
      // We force updated to stay null by making upsertHcmBalance resolve to null (cast)
      balanceRepo.findByKey
        .mockResolvedValueOnce(null) // inside txn: no existing
        .mockResolvedValueOnce(makeBalance({ hcmBalance: 12 })); // for getOne fallback
      balanceRepo.upsertHcmBalance.mockResolvedValue(null as any);
      balanceRepo.writeAuditLog.mockResolvedValue(undefined);

      const result = await service.refresh('EMP-1', 'LOC-1', 'VACATION');
      expect(result.hcmBalance).toBe(12);
    });
  });
});

// ─── HttpExceptionFilter ────────────────────────────────────────────────────

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  function makeHost(res: any, req: any = {}) {
    return {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => req,
      }),
    } as any;
  }

  function makeResponse() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { status, json };
  }

  it('handles OptimisticLockError with 409', () => {
    const res = makeResponse();
    filter.catch(new OptimisticLockError(), makeHost(res));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.status().json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'OPTIMISTIC_LOCK_FAILED' }),
      }),
    );
  });

  it('handles HttpException with object response', () => {
    const res = makeResponse();
    filter.catch(new NotFoundException('not found'), makeHost(res));
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('handles HttpException with string response', () => {
    const res = makeResponse();
    const err = new HttpException('plain string error', 400);
    filter.catch(err, makeHost(res));
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('handles HttpException with BadGatewayException', () => {
    const res = makeResponse();
    filter.catch(new BadGatewayException('hcm down'), makeHost(res));
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('handles HttpException with ConflictException', () => {
    const res = makeResponse();
    filter.catch(new ConflictException('conflict'), makeHost(res));
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('handles generic Error with 500', () => {
    const res = makeResponse();
    filter.catch(new Error('something broke'), makeHost(res));
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('handles unknown non-Error with 500', () => {
    const res = makeResponse();
    filter.catch('a string exception', makeHost(res));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── HcmApiKeyGuard ─────────────────────────────────────────────────────────

describe('HcmApiKeyGuard', () => {
  let guard: HcmApiKeyGuard;

  function makeGuard(expected: string | undefined) {
    const configService = {
      get: (key: string) => (key === 'hcmApiKey' ? expected : undefined),
    } as any;
    return new HcmApiKeyGuard(configService);
  }

  function makeContext(provided: string | undefined) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: provided !== undefined ? { 'x-hcm-api-key': provided } : {},
        }),
      }),
    } as any;
  }

  it('returns true for matching API key', () => {
    guard = makeGuard('secret');
    expect(guard.canActivate(makeContext('secret'))).toBe(true);
  });

  it('throws UnauthorizedException when key is missing', () => {
    guard = makeGuard('secret');
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when expected key is not configured', () => {
    guard = makeGuard(undefined);
    expect(() => guard.canActivate(makeContext('secret'))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when keys do not match', () => {
    guard = makeGuard('secret');
    expect(() => guard.canActivate(makeContext('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when lengths differ (no timingSafeEqual)', () => {
    guard = makeGuard('short');
    expect(() =>
      guard.canActivate(makeContext('a-much-longer-key-that-differs')),
    ).toThrow(UnauthorizedException);
  });
});

// ─── JwtAuthGuard ───────────────────────────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  function makeContext(authorization: string | undefined) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: authorization !== undefined ? { authorization } : {},
        }),
      }),
    } as any;
  }

  it('returns true when Bearer token is present', () => {
    expect(guard.canActivate(makeContext('Bearer some-token'))).toBe(true);
  });

  it('throws UnauthorizedException when Authorization header is missing', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when token does not start with Bearer', () => {
    expect(() => guard.canActivate(makeContext('Basic dXNlcjpwYXNz'))).toThrow(
      UnauthorizedException,
    );
  });
});

// ─── ResponseInterceptor ────────────────────────────────────────────────────

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
  });

  function runInterceptor(data: unknown): Promise<unknown> {
    const next = { handle: () => of(data) } as any;
    return new Promise((resolve) => {
      interceptor.intercept({} as any, next).subscribe(resolve);
    });
  }

  it('wraps plain data in { data, error: null }', async () => {
    const result = await runInterceptor({ foo: 'bar' });
    expect(result).toEqual({ data: { foo: 'bar' }, error: null });
  });

  it('passes through data that already has data+error shape', async () => {
    const shaped = { data: { id: 1 }, error: null };
    const result = await runInterceptor(shaped);
    expect(result).toEqual(shaped);
  });

  it('wraps null data', async () => {
    const result = await runInterceptor(null);
    expect(result).toEqual({ data: null, error: null });
  });

  it('wraps string data', async () => {
    const result = await runInterceptor('hello');
    expect(result).toEqual({ data: 'hello', error: null });
  });
});

// ─── retryOnOptimisticLock ───────────────────────────────────────────────────

describe('retryOnOptimisticLock', () => {
  it('succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryOnOptimisticLock(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on OptimisticLockError and succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new OptimisticLockError())
      .mockResolvedValue('retried');
    const result = await retryOnOptimisticLock(fn, 3, 0);
    expect(result).toBe('retried');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on "database is locked" SQLite error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValue('unlocked');
    const result = await retryOnOptimisticLock(fn, 3, 0);
    expect(result).toBe('unlocked');
  });

  it('retries on "SQLITE_BUSY" error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: resource busy'))
      .mockResolvedValue('done');
    const result = await retryOnOptimisticLock(fn, 3, 0);
    expect(result).toBe('done');
  });

  it('retries on "cannot start a transaction within a transaction" error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('cannot start a transaction within a transaction'),
      )
      .mockResolvedValue('done');
    const result = await retryOnOptimisticLock(fn, 3, 0);
    expect(result).toBe('done');
  });

  it('retries on "SQLITE_LOCKED" error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('SQLITE_LOCKED: table is locked'))
      .mockResolvedValue('done');
    const result = await retryOnOptimisticLock(fn, 3, 0);
    expect(result).toBe('done');
  });

  it('throws immediately for non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('not retryable'));
    await expect(retryOnOptimisticLock(fn)).rejects.toThrow('not retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws last OptimisticLockError', async () => {
    const fn = jest.fn().mockRejectedValue(new OptimisticLockError());
    await expect(retryOnOptimisticLock(fn, 3, 0)).rejects.toThrow(
      OptimisticLockError,
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ─── HcmErrors ──────────────────────────────────────────────────────────────

describe('HcmErrors', () => {
  it('HcmInsufficientBalanceError uses custom message', () => {
    const err = new HcmInsufficientBalanceError('custom msg');
    expect(err.message).toBe('custom msg');
    expect(err.name).toBe('HcmInsufficientBalanceError');
  });

  it('HcmUnavailableError uses custom message', () => {
    const err = new HcmUnavailableError('unavailable');
    expect(err.message).toBe('unavailable');
    expect(err.name).toBe('HcmUnavailableError');
  });

  it('HcmInvalidDimensionsError uses default message', () => {
    const err = new HcmInvalidDimensionsError();
    expect(err.name).toBe('HcmInvalidDimensionsError');
    expect(err.message).toContain('invalid dimensions');
  });

  it('HcmInvalidDimensionsError uses custom message', () => {
    const err = new HcmInvalidDimensionsError('bad dims');
    expect(err.message).toBe('bad dims');
  });
});
