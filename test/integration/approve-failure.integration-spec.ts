import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import nock from 'nock';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import {
  nockGetBalance,
  nockDeductBalanceInsufficient,
} from '../helpers/hcm-nock';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';
import { TimeOffRequest } from '../../src/modules/time-off/entities/time-off-request.entity';

describe('Mandatory Regression #3: Approve failure handling', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    await resetSchema(dataSource);
    await seedBaseline(dataSource, { hcmBalance: 10 });
    nock.cleanAll();
  });

  async function createPendingRequest(): Promise<string> {
    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    const res = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', 'Bearer stub')
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        days: 2,
      })
      .expect(201);
    return res.body.data.requestId;
  }

  it('HCM 422 on approve → returns 409, request stays PENDING, balance unchanged', async () => {
    const requestId = await createPendingRequest();

    nockDeductBalanceInsufficient();
    await request(app.getHttpServer())
      .patch(`/api/v1/time-off/requests/${requestId}/approve`)
      .set('Authorization', 'Bearer stub')
      .expect(409);

    // Request must still be PENDING
    const dbRequest = await dataSource.manager.findOne(TimeOffRequest, {
      where: { id: requestId },
    });
    expect(dbRequest!.status).toBe('PENDING');
    expect(dbRequest!.hcmReferenceId).toBeNull();

    // Balance must be unchanged (pending_days still 2)
    const balance = await dataSource.manager.findOne(LeaveBalance, {
      where: {
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
      },
    });
    expect(balance!.pendingDays).toBe(2);
  });

  it('HCM 5xx on approve → returns 502, request stays PENDING', async () => {
    const requestId = await createPendingRequest();

    // Register enough 503 interceptors to cover all retry attempts (3 retries + initial = 4 attempts)
    nock('http://localhost:3001')
      .post('/hcm/balances/deduct')
      .reply(503, { message: 'unavailable' })
      .persist();

    await request(app.getHttpServer())
      .patch(`/api/v1/time-off/requests/${requestId}/approve`)
      .set('Authorization', 'Bearer stub')
      .expect(502);

    const dbRequest = await dataSource.manager.findOne(TimeOffRequest, {
      where: { id: requestId },
    });
    expect(dbRequest!.status).toBe('PENDING');
  });
});
