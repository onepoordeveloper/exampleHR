import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffController } from './time-off.controller';
import { TimeOffService } from './time-off.service';
import { TimeOffRepository } from './time-off.repository';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { BalanceModule } from '../balance/balance.module';
import { HcmSyncModule } from '../hcm-sync/hcm-sync.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalanceModule,
    HcmSyncModule,
  ],
  controllers: [TimeOffController],
  providers: [TimeOffService, TimeOffRepository],
  exports: [TimeOffService, TimeOffRepository],
})
export class TimeOffModule {}
