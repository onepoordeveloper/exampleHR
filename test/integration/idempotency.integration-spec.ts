import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import nock from 'nock';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { nockGetBalance } from '../helpers/hcm-nock';
import { TimeOffRequest } from '../../src/modules/time-off/entities/time-off-request.entity';

describe('Mandatory Regression #5: Idempotency key deduplication', () => {
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

  it('returns same response on duplicate idempotency key, no second DB row', async () => {
    const idempotencyKey = `test-key-${Date.now()}`;

    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    const res1 = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', 'Bearer stub')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        days: 2,
      })
      .expect(201);

    // Second request with same key — no HCM call should happen
    const res2 = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', 'Bearer stub')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        days: 2,
      })
      .expect(201);

    // Same requestId
    expect(res1.body.data.requestId).toBe(res2.body.data.requestId);

    // Only one row in the DB
    const rows = await dataSource.manager.find(TimeOffRequest, {
      where: { employeeId: 'EMP-1' },
    });
    expect(rows).toHaveLength(1);
  });
});
