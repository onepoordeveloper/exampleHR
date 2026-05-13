import { Module } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { HcmApiKeyGuard } from './guards/hcm-api-key.guard';

@Module({
  providers: [
    HttpExceptionFilter,
    ResponseInterceptor,
    LoggingInterceptor,
    JwtAuthGuard,
    HcmApiKeyGuard,
  ],
  exports: [
    HttpExceptionFilter,
    ResponseInterceptor,
    LoggingInterceptor,
    JwtAuthGuard,
    HcmApiKeyGuard,
  ],
})
export class CommonModule {}
