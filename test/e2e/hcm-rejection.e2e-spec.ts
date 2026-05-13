import request from 'supertest';
import axios from 'axios';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { startMockHcm, stopMockHcm } from '../helpers/mock-hcm.factory';
import { TimeOffRequest } from '../../src/modules/time-off/entities/time-off-request.entity';

const HCM = 'http://localhost:3001';
const AUTH = 'Bearer stub';

describe('E2E: HCM rejects approval when balance is 0', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    await startMockHcm(3001);
    ({ app, dataSource } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await stopMockHcm();
  });

  beforeEach(async () => {
    await axios.post(`${HCM}/hcm/debug/reset`);
    await resetSchema(dataSource);
    await seedBaseline(dataSource, { hcmBalance: 10 });
    // Set HCM to have 10 days
    await axios.put(`${HCM}/hcm/debug/balance`, {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      balance: 10,
    });
  });

  it('approve fails with 409 when HCM has 0 balance', async () => {
    // Create request (ExampleHR has 10 days, HCM has 10 days)
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', AUTH)
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        days: 3,
      })
      .expect(201);

    const requestId = createRes.body.data.requestId;

    // Manually force HCM balance to 0 (simulate external drain)
    await axios.put(`${HCM}/hcm/debug/balance`, {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      balance: 0,
    });

    // Attempt approval — HCM should reject with 422 → ExampleHR maps to 409
    await request(app.getHttpServer())
      .patch(`/api/v1/time-off/requests/${requestId}/approve`)
      .set('Authorization', AUTH)
      .expect(409);

    // Request must remain PENDING
    const dbRequest = await dataSource.manager.findOne(TimeOffRequest, {
      where: { id: requestId },
    });
    expect(dbRequest!.status).toBe('PENDING');
  });
});
