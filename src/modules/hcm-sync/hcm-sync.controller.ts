import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HcmSyncService } from './hcm-sync.service';
import { HcmApiKeyGuard } from '../../common/guards/hcm-api-key.guard';
import { BatchSyncDto } from './dto/batch-sync.dto';
import { SingleSyncDto } from './dto/single-sync.dto';

@ApiTags('hcm-sync')
@ApiSecurity('hcm-api-key')
@Controller('api/v1/hcm/sync')
@UseGuards(HcmApiKeyGuard)
export class HcmSyncController {
  constructor(private readonly hcmSyncService: HcmSyncService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive full balance corpus from HCM (reconciles all balances)',
  })
  processBatch(@Body() dto: BatchSyncDto) {
    return this.hcmSyncService.processBatch(dto);
  }

  @Post('single')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive a single balance update from HCM (e.g. anniversary bonus)',
  })
  processSingle(@Body() dto: SingleSyncDto) {
    return this.hcmSyncService.processSingle(dto);
  }
}
