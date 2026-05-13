import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MockHcmAppModule } from './mock-hcm-app.module';

async function bootstrap() {
  const app = await NestFactory.create(MockHcmAppModule, {
    logger: ['log', 'error', 'warn'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = process.env.MOCK_HCM_PORT ?? 3001;
  await app.listen(port);
  console.log(`Mock HCM running on port ${port}`);
}
void bootstrap();
