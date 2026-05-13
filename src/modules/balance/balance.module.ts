import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { BalanceRepository } from './balance.repository';
import { LeaveBalance } from './entities/leave-balance.entity';
import { BalanceAuditLog } from './entities/balance-audit-log.entity';
import { Employee } from './entities/employee.entity';
import { Location } from './entities/location.entity';
import { HcmSyncModule } from '../hcm-sync/hcm-sync.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveBalance,
      BalanceAuditLog,
      Employee,
      Location,
    ]),
    HcmSyncModule,
  ],
  controllers: [BalanceController],
  providers: [BalanceService, BalanceRepository],
  exports: [BalanceService, BalanceRepository],
})
export class BalanceModule {}
