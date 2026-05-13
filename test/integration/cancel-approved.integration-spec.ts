import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import nock from 'nock';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import {
  nockGetBalance,
  nockDeductBalance,
  nockCreditBalance,
} from '../helpers/hcm-nock';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';

describe('Mandatory Regression #4: Cancel approved request calls HCM credit exactly once', () => {
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

  it('cancels APPROVED request and calls HCM credit exactly once', async () => {
    // Create
    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', 'Bearer stub')
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        days: 3,
      })
      .expect(201);

    const requestId = createRes.body.data.requestId;

    // Approve
    nockDeductBalance('HCM-REF-1', 7);
    await request(app.getHttpServer())
      .patch(`/api/v1/time-off/requests/${requestId}/approve`)
      .set('Authorization', 'Bearer stub')
      .expect(200);

    // Cancel (should call HCM credit exactly once)
    const creditScope = nockCreditBalance();
    await request(app.getHttpServer())
      .delete(`/api/v1/time-off/requests/${requestId}`)
      .set('Authorization', 'Bearer stub')
      .expect(200);

    // Verify nock was called exactly once
    expect(creditScope.isDone()).toBe(true);

    // Balance should be restored (hcm_balance back to 10)
    const balance = await dataSource.manager.findOne(LeaveBalance, {
      where: {
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
      },
    });
    expect(balance!.hcmBalance).toBe(10);
    expect(balance!.pendingDays).toBe(0);
  });

  it('cancels PENDING request without calling HCM', async () => {
    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', 'Bearer stub')
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        days: 2,
      })
      .expect(201);

    const requestId = createRes.body.data.requestId;

    // No nock for credit — if HCM is called the test will throw
    await request(app.getHttpServer())
      .delete(`/api/v1/time-off/requests/${requestId}`)
      .set('Authorization', 'Bearer stub')
      .expect(200);

    const balance = await dataSource.manager.findOne(LeaveBalance, {
      where: {
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
      },
    });
    expect(balance!.pendingDays).toBe(0);
  });
});
