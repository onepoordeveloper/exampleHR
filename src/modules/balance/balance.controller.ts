import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { BalanceService } from './balance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('balances')
@ApiBearerAuth('employee-auth')
@Controller('api/v1/employees/:employeeId/balances')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  @ApiOperation({ summary: 'Get all leave balances for an employee' })
  @ApiParam({ name: 'employeeId', example: 'EMP-1' })
  listBalances(@Param('employeeId') employeeId: string) {
    return this.balanceService.listByEmployee(employeeId);
  }

  @Get(':locationId')
  @ApiOperation({
    summary: 'Get a single leave balance (employee + location + leaveType)',
  })
  @ApiParam({ name: 'employeeId', example: 'EMP-1' })
  @ApiParam({ name: 'locationId', example: 'LOC-1' })
  @ApiQuery({
    name: 'leaveType',
    required: false,
    example: 'VACATION',
    enum: ['VACATION', 'SICK', 'PERSONAL', 'OTHER'],
  })
  getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query('leaveType') leaveType = 'VACATION',
  ) {
    return this.balanceService.getOne(employeeId, locationId, leaveType);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Force a real-time balance fetch from HCM and update local shadow',
  })
  @ApiParam({ name: 'employeeId', example: 'EMP-1' })
  refreshBalance(
    @Param('employeeId') employeeId: string,
    @Body() body: { locationId: string; leaveType?: string },
  ) {
    return this.balanceService.refresh(
      employeeId,
      body.locationId,
      body.leaveType ?? 'VACATION',
    );
  }
}
