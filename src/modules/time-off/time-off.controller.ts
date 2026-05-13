import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { TimeOffService } from './time-off.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('time-off')
@ApiBearerAuth('employee-auth')
@Controller('api/v1/time-off/requests')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a time-off request (status: PENDING)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Unique key to prevent duplicate submissions',
  })
  createRequest(
    @Body() dto: CreateTimeOffRequestDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.timeOffService.createRequest(dto, idempotencyKey);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single time-off request by ID' })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  getRequest(@Param('id') id: string) {
    return this.timeOffService.getRequest(id);
  }

  @Get()
  @ApiOperation({
    summary: 'List time-off requests with optional filters and pagination',
  })
  @ApiQuery({ name: 'employeeId', required: false, example: 'EMP-1' })
  @ApiQuery({ name: 'locationId', required: false, example: 'LOC-1' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'],
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  listRequests(@Query() query: ListRequestsQueryDto) {
    return this.timeOffService.listRequests(query);
  }

  @Patch(':id/approve')
  @ApiOperation({
    summary: 'Approve a PENDING request (calls HCM to deduct balance)',
  })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  approveRequest(@Param('id') id: string) {
    return this.timeOffService.approveRequest(id);
  }

  @Patch(':id/reject')
  @ApiOperation({
    summary: 'Reject a PENDING request (releases local reservation)',
  })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  @ApiBody({
    schema: {
      properties: { reason: { type: 'string', example: 'Team at capacity' } },
    },
  })
  rejectRequest(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.timeOffService.rejectRequest(id, body.reason);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark an APPROVED request as COMPLETED' })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  completeRequest(@Param('id') id: string) {
    return this.timeOffService.completeRequest(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel a request (PENDING: releases reservation; APPROVED: credits back to HCM)',
  })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  cancelRequest(@Param('id') id: string) {
    return this.timeOffService.cancelRequest(id);
  }
}
