import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MockHcmAppModule } from '../../mock-hcm/mock-hcm-app.module';

let mockHcmInstance: INestApplication | null = null;
let startPromise: Promise<INestApplication> | null = null;

export async function startMockHcm(port = 3001): Promise<INestApplication> {
  if (mockHcmInstance) return mockHcmInstance;
  if (startPromise) return startPromise;

  process.env.HCM_API_KEY = 'test-hcm-secret';
  process.env.EXAMPLEHR_BASE_URL = 'http://127.0.0.1:3000';
  process.env.MOCK_HCM_PORT = String(port);

  startPromise = NestFactory.create(MockHcmAppModule, { logger: false }).then(
    async (app) => {
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, transform: true }),
      );
      await app.listen(port);
      mockHcmInstance = app;
      startPromise = null;
      return app;
    },
  );

  return startPromise;
}

export async function stopMockHcm(): Promise<void> {
  if (mockHcmInstance) {
    await mockHcmInstance.close();
    mockHcmInstance = null;
  }
}
