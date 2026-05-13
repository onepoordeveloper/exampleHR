import request from 'supertest';
import axios from 'axios';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { startMockHcm, stopMockHcm } from '../helpers/mock-hcm.factory';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';

const HCM = 'http://localhost:3001';
const AUTH = 'Bearer stub';

describe('E2E: Race condition with live mock HCM', () => {
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
    await seedBaseline(dataSource, { hcmBalance: 5 });
    await axios.put(`${HCM}/hcm/debug/balance`, {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      balance: 5,
    });
  });

  it('concurrent requests that together exceed balance yield exactly 1 success and 1 failure', async () => {
    const body = {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      startDate: '2026-06-01',
      endDate: '2026-06-04',
      days: 4,
    };

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/time-off/requests')
        .set('Authorization', AUTH)
        .send(body),
      request(app.getHttpServer())
        .post('/api/v1/time-off/requests')
        .set('Authorization', AUTH)
        .send(body),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const balance = await dataSource.manager.findOne(LeaveBalance, {
      where: {
        employeeId: 'EMP-1',
        locationId: 'LOC-1',
        leaveType: 'VACATION',
      },
    });
    expect(balance!.pendingDays).toBe(4);
  });
});
