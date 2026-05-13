import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Time-Off Microservice')
    .setDescription(
      'Manages time-off request lifecycle and syncs leave balances with HCM (Workday/SAP)',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'employee-auth')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-HCM-API-Key' },
      'hcm-api-key',
    )
    .addTag('balances', 'Leave balance reads and HCM refresh')
    .addTag('time-off', 'Time-off request lifecycle')
    .addTag('hcm-sync', 'Inbound HCM sync (batch and single)')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
void bootstrap();
