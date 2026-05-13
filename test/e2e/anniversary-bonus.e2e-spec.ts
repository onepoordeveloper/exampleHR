import request from 'supertest';
import axios from 'axios';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createListeningTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { startMockHcm, stopMockHcm } from '../helpers/mock-hcm.factory';

const HCM = 'http://localhost:3001';
const AUTH = 'Bearer stub';

describe('E2E: Anniversary bonus → balance auto-updates via webhook', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    await startMockHcm(3001);
    ({ app, dataSource } = await createListeningTestApp(3000));
  });

  afterAll(async () => {
    await app.close();
    await stopMockHcm();
  });

  beforeEach(async () => {
    await axios.post(`${HCM}/hcm/debug/reset`);
    await resetSchema(dataSource);
    await seedBaseline(dataSource, { hcmBalance: 5 });
    // Seed HCM state to match DB
    await axios.put(`${HCM}/hcm/debug/balance`, {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      balance: 5,
    });
  });

  it('anniversary bonus in HCM triggers sync and increases availableDays', async () => {
    // Trigger anniversary bonus in mock HCM (it will push single sync to ExampleHR)
    await axios.post(`${HCM}/hcm/debug/anniversary`, {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      bonusDays: 5,
    });

    // Wait for the async webhook to be processed
    await new Promise((r) => setTimeout(r, 500));

    // ExampleHR balance should now reflect the bonus
    const balanceRes = await request(app.getHttpServer())
      .get('/api/v1/employees/EMP-1/balances/LOC-1?leaveType=VACATION')
      .set('Authorization', AUTH)
      .expect(200);

    expect(balanceRes.body.data.availableDays).toBe(10); // 5 original + 5 bonus
    expect(balanceRes.body.data.hcmBalance).toBe(10);
  });
});
