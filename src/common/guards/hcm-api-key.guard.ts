import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class HcmApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppConfig>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-hcm-api-key'];
    const expected = this.configService.get<string>('hcmApiKey');

    if (!provided || typeof provided !== 'string' || !expected) {
      throw new UnauthorizedException('Missing HCM API key');
    }

    let match = false;
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length === b.length) {
        match = timingSafeEqual(a, b);
      }
    } catch {
      match = false;
    }

    if (!match) {
      throw new UnauthorizedException('Invalid HCM API key');
    }

    return true;
  }
}
