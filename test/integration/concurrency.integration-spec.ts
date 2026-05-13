import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import nock from 'nock';
import { createTestApp } from '../helpers/test-app.factory';
import { seedBaseline, resetSchema } from '../helpers/seed';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';

describe('Mandatory Regression #1: Concurrent requests exceeding balance', () => {
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
    nock.cleanAll();
  });

  it('only one of two concurrent requests succeeds when they together exceed balance', async () => {
    // Balance: 5 days available, two requests for 4 days each
    await seedBaseline(dataSource, { hcmBalance: 5 });

    // Both requests will call HCM getBalance — allow both to see 5 days
    nock('http://localhost:3001')
      .get('/hcm/balances/EMP-1/LOC-1/VACATION')
      .reply(200, { availableBalance: 5 })
      .persist();

    const requestBody = {
      employeeId: 'EMP-1',
      locationId: 'LOC-1',
      leaveType: 'VACATION',
      startDate: '2026-06-01',
      endDate: '2026-06-04',
      days: 4,
    };

    // Fire both requests simultaneously
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/time-off/requests')
        .set('Authorization', 'Bearer stub')
        .send(requestBody),
      request(app.getHttpServer())
        .post('/api/v1/time-off/requests')
        .set('Authorization', 'Bearer stub')
        .send(requestBody),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one 201 and one 409
    expect(statuses).toEqual([201, 409]);

    // Verify DB state: pending_days should be exactly 4 (not 8)
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
