import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import nock from 'nock';
import { HcmClientService } from '../../src/modules/hcm-sync/hcm-client.service';
import {
  HcmInsufficientBalanceError,
  HcmUnavailableError,
} from '../../src/modules/hcm-sync/hcm.errors';

const HCM_BASE = 'http://localhost:3001';

describe('HcmClientService', () => {
  let service: HcmClientService;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        HcmClientService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                hcmBaseUrl: HCM_BASE,
                hcmRequestTimeoutMs: 5000,
                hcmRetryAttempts: 3,
              };
              return map[key];
            },
          },
        },
      ],
    }).compile();
    service = module.get(HcmClientService);
  });

  describe('getBalance', () => {
    it('retries on 500 and succeeds on 200', async () => {
      nock(HCM_BASE).get('/hcm/balances/EMP-1/LOC-1/VACATION').reply(500);
      nock(HCM_BASE)
        .get('/hcm/balances/EMP-1/LOC-1/VACATION')
        .reply(200, { availableBalance: 7 });

      const result = await service.getBalance('EMP-1', 'LOC-1', 'VACATION');
      expect(result).toBe(7);
    });

    it('throws HcmUnavailableError after all retries fail', async () => {
      nock(HCM_BASE)
        .get('/hcm/balances/EMP-1/LOC-1/VACATION')
        .reply(500)
        .persist();
      await expect(
        service.getBalance('EMP-1', 'LOC-1', 'VACATION'),
      ).rejects.toThrow(HcmUnavailableError);
    });
  });

  describe('deductBalance', () => {
    it('returns hcmReferenceId on 200', async () => {
      nock(HCM_BASE)
        .post('/hcm/balances/deduct')
        .reply(200, { hcmReferenceId: 'HCM-REF-123', newBalance: 8 });

      const refId = await service.deductBalance(
        'EMP-1',
        'LOC-1',
        'VACATION',
        2,
      );
      expect(refId).toBe('HCM-REF-123');
    });

    it('throws HcmInsufficientBalanceError immediately on 422 (no retry)', async () => {
      let callCount = 0;
      nock(HCM_BASE)
        .post('/hcm/balances/deduct')
        .reply(() => {
          callCount++;
          return [422, { message: 'insufficient' }];
        })
        .persist();

      await expect(
        service.deductBalance('EMP-1', 'LOC-1', 'VACATION', 99),
      ).rejects.toThrow(HcmInsufficientBalanceError);
      expect(callCount).toBe(1); // no retry on 422
    });
  });

  describe('creditBalance', () => {
    it('resolves on 200', async () => {
      nock(HCM_BASE).post('/hcm/balances/credit').reply(200);
      await expect(
        service.creditBalance('EMP-1', 'LOC-1', 'VACATION', 2),
      ).resolves.toBeUndefined();
    });

    it('throws HcmUnavailableError on 500', async () => {
      nock(HCM_BASE).post('/hcm/balances/credit').reply(500).persist();
      await expect(
        service.creditBalance('EMP-1', 'LOC-1', 'VACATION', 2),
      ).rejects.toThrow(HcmUnavailableError);
    });
  });

  describe('handleError - invalid dimensions branch', () => {
    it('throws HcmInvalidDimensionsError on 400 from deductBalance', async () => {
      const { HcmInvalidDimensionsError } =
        await import('../../src/modules/hcm-sync/hcm.errors');
      nock(HCM_BASE)
        .post('/hcm/balances/deduct')
        .reply(400, { message: 'invalid employee' });

      await expect(
        service.deductBalance('BAD-EMP', 'LOC-1', 'VACATION', 2),
      ).rejects.toThrow(HcmInvalidDimensionsError);
    });

    it('throws HcmInvalidDimensionsError on 404 from getBalance', async () => {
      const { HcmInvalidDimensionsError } =
        await import('../../src/modules/hcm-sync/hcm.errors');
      nock(HCM_BASE)
        .get('/hcm/balances/BAD-EMP/LOC-1/VACATION')
        .reply(404, { message: 'not found' });

      await expect(
        service.getBalance('BAD-EMP', 'LOC-1', 'VACATION'),
      ).rejects.toThrow(HcmInvalidDimensionsError);
    });
  });
});
