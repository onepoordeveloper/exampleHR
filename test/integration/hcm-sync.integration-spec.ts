import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import nock from 'nock';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';

describe('Mandatory Regression #2: Batch sync updates available balance', () => {
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
    await seedBaseline(dataSource, { hcmBalance: 5 });
    nock.cleanAll();
  });

  it('batch sync with anniversary bonus increases availableDays', async () => {
    // Employee has 5 days. HCM sends batch with 10 days (anniversary bonus)
    const syncRes = await request(app.getHttpServer())
      .post('/api/v1/hcm/sync/batch')
      .set('X-HCM-API-Key', 'test-hcm-secret')
      .send({
        batchId: crypto.randomUUID(),
        syncedAt: new Date().toISOString(),
        balances: [
          {
            employeeId: 'EMP-1',
            locationId: 'LOC-1',
            leaveType: 'VACATION',
            availableBalance: 10,
          },
        ],
      })
      .expect(200);

    expect(syncRes.body.data.processed).toBe(1);
    expect(syncRes.body.data.discrepanciesFound).toBe(0);

    // Verify the balance was updated
    const balance = await dataSource.manager.findOne(LeaveBalance, {
      where: {
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
      },
    });
    expect(balance!.hcmBalance).toBe(10);

    // GET balance endpoint should show updated availableDays
    const balanceRes = await request(app.getHttpServer())
      .get('/api/v1/employees/EMP-1/balances/LOC-1?leaveType=VACATION')
      .set('Authorization', 'Bearer stub')
      .expect(200);

    expect(balanceRes.body.data.availableDays).toBe(10);
  });

  it('batch sync rejects with 401 without HCM API key', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/hcm/sync/batch')
      .send({
        batchId: crypto.randomUUID(),
        syncedAt: new Date().toISOString(),
        balances: [],
      })
      .expect(401);
  });
});
