import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import nock from 'nock';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { nockGetBalance, nockDeductBalance } from '../helpers/hcm-nock';

describe('Time-Off Integration (lifecycle)', () => {
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

  const AUTH = 'Bearer stub-token';

  it('creates a request, approves it, and shows APPROVED on GET', async () => {
    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', AUTH)
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        days: 2,
      })
      .expect(201);

    const requestId = createRes.body.data.requestId;
    expect(createRes.body.data.status).toBe('PENDING');

    nockDeductBalance('HCM-REF-1', 8);
    const approveRes = await request(app.getHttpServer())
      .patch(`/api/v1/time-off/requests/${requestId}/approve`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(approveRes.body.data.status).toBe('APPROVED');

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/time-off/requests/${requestId}`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(getRes.body.data.status).toBe('APPROVED');
    expect(getRes.body.data.hcmReferenceId).toBe('HCM-REF-1');
  });

  it('rejects a request and employee can create new request afterward', async () => {
    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', AUTH)
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

    await request(app.getHttpServer())
      .patch(`/api/v1/time-off/requests/${requestId}/reject`)
      .set('Authorization', AUTH)
      .send({ reason: 'Too many people off' })
      .expect(200);

    // After rejection, balance should be restored — can create another request
    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', AUTH)
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        days: 3,
      })
      .expect(201);
  });

  it('returns 404 for unknown request', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/time-off/requests/nonexistent-id')
      .set('Authorization', AUTH)
      .expect(404);
  });

  it('returns paginated list of requests', async () => {
    nockGetBalance('EMP-1', 'LOC-1', 'VACATION', 10);
    await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', AUTH)
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        days: 1,
      })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/time-off/requests?employeeId=EMP-1&page=1&limit=10')
      .set('Authorization', AUTH)
      .expect(200);

    expect(listRes.body.data.data).toHaveLength(1);
    expect(listRes.body.data.total).toBe(1);
  });

  it('returns 401 without Authorization header', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        days: 1,
      })
      .expect(401);
  });
});
