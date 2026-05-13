import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const requestId = crypto.randomUUID();
    (request as Request & { requestId: string }).requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    const { method, url } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(
            `${method} ${url} ${response.statusCode} ${ms}ms [${requestId}]`,
          );
        },
        error: () => {
          const ms = Date.now() - start;
          this.logger.warn(`${method} ${url} ERR ${ms}ms [${requestId}]`);
        },
      }),
    );
  }
}
