import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';

export interface TestApp {
  app: INestApplication;
  dataSource: DataSource;
}

export async function createTestApp(): Promise<TestApp> {
  process.env.NODE_ENV = 'test';
  process.env.HCM_API_KEY = 'test-hcm-secret';
  process.env.HCM_BASE_URL = 'http://localhost:3001';
  process.env.EXAMPLEHR_BASE_URL = 'http://localhost:3000';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const dataSource = moduleFixture.get(DataSource);
  return { app, dataSource };
}

/**
 * Creates a NestJS app that actually listens on a real TCP port.
 * Required for E2E tests where an external service (mock HCM) needs to
 * call back into the main app via HTTP (e.g. anniversary webhook sync).
 */
export async function createListeningTestApp(port = 3000): Promise<TestApp> {
  process.env.NODE_ENV = 'test';
  process.env.HCM_API_KEY = 'test-hcm-secret';
  process.env.HCM_BASE_URL = 'http://localhost:3001';
  process.env.EXAMPLEHR_BASE_URL = `http://127.0.0.1:${port}`;

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(port);

  const dataSource = moduleFixture.get(DataSource);
  return { app, dataSource };
}
