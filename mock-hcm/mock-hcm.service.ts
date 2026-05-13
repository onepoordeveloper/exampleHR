import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MockHcmService {
  private readonly logger = new Logger(MockHcmService.name);
  private readonly state = new Map<string, number>();
  private refCounter = 0;

  private key(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): string {
    return `${employeeId}:${locationId}:${leaveType}`;
  }

  getBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): number {
    return this.state.get(this.key(employeeId, locationId, leaveType)) ?? 0;
  }

  deduct(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): { newBalance: number; hcmReferenceId: string } {
    const k = this.key(employeeId, locationId, leaveType);
    const current = this.state.get(k) ?? 0;
    if (current < days) {
      throw new UnprocessableEntityException(
        `Insufficient balance: ${current} available, ${days} requested`,
      );
    }
    const newBalance = current - days;
    this.state.set(k, newBalance);
    this.refCounter++;
    return { newBalance, hcmReferenceId: `HCM-REF-${this.refCounter}` };
  }

  credit(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): { newBalance: number } {
    const k = this.key(employeeId, locationId, leaveType);
    const current = this.state.get(k) ?? 0;
    const newBalance = current + days;
    this.state.set(k, newBalance);
    return { newBalance };
  }

  setBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    balance: number,
  ): void {
    this.state.set(this.key(employeeId, locationId, leaveType), balance);
  }

  applyAnniversary(
    employeeId: string,
    locationId: string,
    leaveType: string,
    bonusDays: number,
    exampleHrBaseUrl: string,
  ): void {
    const k = this.key(employeeId, locationId, leaveType);
    const current = this.state.get(k) ?? 0;
    const newBalance = current + bonusDays;
    this.state.set(k, newBalance);

    this.logger.log(
      `Anniversary bonus applied: ${employeeId} +${bonusDays} days → ${newBalance}`,
    );

    // Fire-and-forget push to ExampleHR
    setImmediate(() => {
      void (async () => {
        try {
          await axios.post(
            `${exampleHrBaseUrl}/api/v1/hcm/sync/single`,
            {
              employeeId,
              locationId,
              leaveType,
              availableBalance: newBalance,
              reason: 'ANNIVERSARY_BONUS',
            },
            {
              headers: {
                'X-HCM-API-Key': process.env.HCM_API_KEY ?? 'dev-secret',
                'Content-Type': 'application/json',
              },
            },
          );
          this.logger.log(`Single sync pushed to ExampleHR for ${employeeId}`);
        } catch (err) {
          this.logger.warn(
            `Failed to push single sync to ExampleHR: ${(err as Error).message}`,
          );
        }
      })();
    });
  }

  async pushBatchToExampleHr(exampleHrBaseUrl: string): Promise<void> {
    const balances = Array.from(this.state.entries()).map(
      ([k, availableBalance]) => {
        const [employeeId, locationId, leaveType] = k.split(':');
        return { employeeId, locationId, leaveType, availableBalance };
      },
    );

    await axios.post(
      `${exampleHrBaseUrl}/api/v1/hcm/sync/batch`,
      {
        batchId: crypto.randomUUID(),
        syncedAt: new Date().toISOString(),
        balances,
      },
      {
        headers: {
          'X-HCM-API-Key': process.env.HCM_API_KEY ?? 'dev-secret',
          'Content-Type': 'application/json',
        },
      },
    );
  }

  reset(): void {
    this.state.clear();
    this.refCounter = 0;
  }

  dump(): Record<string, number> {
    return Object.fromEntries(this.state.entries());
  }
}
