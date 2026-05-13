import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HcmClientService } from './hcm-client.service';
import { HcmSyncService } from './hcm-sync.service';
import { HcmSyncController } from './hcm-sync.controller';
import { BalanceRepository } from '../balance/balance.repository';
import { TimeOffRepository } from '../time-off/time-off.repository';
import { LeaveBalance } from '../balance/entities/leave-balance.entity';
import { BalanceAuditLog } from '../balance/entities/balance-audit-log.entity';
import { TimeOffRequest } from '../time-off/entities/time-off-request.entity';
import { AppConfig } from '../../config/configuration';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<AppConfig>) => ({
        timeout: cfg.get<number>('hcmRequestTimeoutMs') ?? 5000,
        baseURL: cfg.get<string>('hcmBaseUrl'),
        headers: { 'Content-Type': 'application/json' },
      }),
    }),
    TypeOrmModule.forFeature([LeaveBalance, BalanceAuditLog, TimeOffRequest]),
  ],
  controllers: [HcmSyncController],
  providers: [
    HcmClientService,
    HcmSyncService,
    BalanceRepository,
    TimeOffRepository,
  ],
  exports: [HcmClientService, HcmSyncService],
})
export class HcmSyncModule {}
