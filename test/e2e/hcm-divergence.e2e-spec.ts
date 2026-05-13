import request from 'supertest';
import axios from 'axios';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { startMockHcm, stopMockHcm } from '../helpers/mock-hcm.factory';

const HCM = 'http://localhost:3001';
const AUTH = 'Bearer stub';

describe('E2E: HCM balance changed externally mid-session', () => {
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
  });

  it('uses authoritative HCM balance when local shadow is stale', async () => {
    // Seed local: 10 days, HCM: also 10 days
    await seedBaseline(dataSource, { hcmBalance: 10 });
    await axios.put(`${HCM}/hcm/debug/balance`, {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      balance: 10,
    });

    // External change: HCM balance drops to 2 (not synced to ExampleHR yet)
    await axios.put(`${HCM}/hcm/debug/balance`, {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      balance: 2,
    });

    // Try to request 5 days — local shadow says 10, but HCM says 2
    // The real-time HCM check should catch this
    await request(app.getHttpServer())
      .post('/api/v1/time-off/requests')
      .set('Authorization', AUTH)
      .send({
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        days: 5,
      })
      .expect(409); // Should fail because HCM has only 2 days

    // But a request for 2 days should succeed
    await request(app.getHttpServer())
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
  });
});
