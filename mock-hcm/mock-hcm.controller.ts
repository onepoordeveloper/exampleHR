import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { MockHcmService } from './mock-hcm.service';
import { DeductBalanceDto } from './dto/deduct-balance.dto';
import { CreditBalanceDto } from './dto/credit-balance.dto';
import { SetBalanceDto } from './dto/set-balance.dto';
import { AnniversaryDto } from './dto/anniversary.dto';

@Controller()
export class MockHcmController {
  private get exampleHrBaseUrl(): string {
    return process.env.EXAMPLEHR_BASE_URL ?? 'http://localhost:3000';
  }

  constructor(private readonly mockHcmService: MockHcmService) {}

  @Get('hcm/balances/:employeeId/:locationId/:leaveType')
  getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Param('leaveType') leaveType: string,
  ) {
    return {
      employeeId,
      locationId,
      leaveType,
      availableBalance: this.mockHcmService.getBalance(
        employeeId,
        locationId,
        leaveType,
      ),
    };
  }

  @Post('hcm/balances/deduct')
  deductBalance(@Body() dto: DeductBalanceDto) {
    const leaveType = dto.leaveType ?? 'VACATION';
    return this.mockHcmService.deduct(
      dto.employeeId,
      dto.locationId,
      leaveType,
      dto.days,
    );
  }

  @Post('hcm/balances/credit')
  creditBalance(@Body() dto: CreditBalanceDto) {
    return this.mockHcmService.credit(
      dto.employeeId,
      dto.locationId,
      dto.leaveType ?? 'VACATION',
      dto.days,
    );
  }

  @Post('hcm/sync/push-to-examplehr')
  async pushBatch() {
    await this.mockHcmService.pushBatchToExampleHr(this.exampleHrBaseUrl);
    return { ok: true };
  }

  // Debug endpoints
  @Put('hcm/debug/balance')
  setBalance(@Body() dto: SetBalanceDto) {
    this.mockHcmService.setBalance(
      dto.employeeId,
      dto.locationId,
      dto.leaveType ?? 'VACATION',
      dto.balance,
    );
    return { ok: true };
  }

  @Post('hcm/debug/anniversary')
  anniversary(@Body() dto: AnniversaryDto) {
    this.mockHcmService.applyAnniversary(
      dto.employeeId,
      dto.locationId,
      dto.leaveType ?? 'VACATION',
      dto.bonusDays,
      this.exampleHrBaseUrl,
    );
    return { ok: true, bonusDays: dto.bonusDays };
  }

  @Post('hcm/debug/reset')
  reset() {
    this.mockHcmService.reset();
    return { ok: true };
  }

  @Get('hcm/debug/state')
  state() {
    return this.mockHcmService.dump();
  }
}
