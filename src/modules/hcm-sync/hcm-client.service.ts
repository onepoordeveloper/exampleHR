import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import axiosRetry from 'axios-retry';
import { AxiosError } from 'axios';
import { AppConfig } from '../../config/configuration';
import {
  HcmInsufficientBalanceError,
  HcmInvalidDimensionsError,
  HcmUnavailableError,
} from './hcm.errors';

@Injectable()
export class HcmClientService {
  private readonly logger = new Logger(HcmClientService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfig>,
  ) {
    this.baseUrl = this.configService.get<string>('hcmBaseUrl')!;

    axiosRetry(this.httpService.axiosRef, {
      retries: this.configService.get<number>('hcmRetryAttempts') ?? 3,
      retryDelay: (_retryCount) => {
        const delays = [100, 400, 1600];
        return delays[_retryCount - 1] ?? 1600;
      },
      retryCondition: (error: AxiosError) => {
        if (!error.response) return true; // network error / timeout
        return error.response.status >= 500;
      },
    });
  }

  async getBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<number> {
    try {
      const response = await this.httpService.axiosRef.get<{
        availableBalance: number;
      }>(
        `${this.baseUrl}/hcm/balances/${employeeId}/${locationId}/${leaveType}`,
      );
      return response.data.availableBalance;
    } catch (error) {
      this.handleError(error, 'getBalance');
    }
  }

  async deductBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): Promise<string> {
    try {
      const response = await this.httpService.axiosRef.post<{
        hcmReferenceId: string;
        newBalance: number;
      }>(`${this.baseUrl}/hcm/balances/deduct`, {
        employeeId,
        locationId,
        leaveType,
        days,
      });
      return response.data.hcmReferenceId;
    } catch (error) {
      this.handleError(error, 'deductBalance');
    }
  }

  async creditBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    originalReferenceId?: string,
  ): Promise<void> {
    try {
      await this.httpService.axiosRef.post(
        `${this.baseUrl}/hcm/balances/credit`,
        {
          employeeId,
          locationId,
          leaveType,
          days,
          originalReferenceId,
        },
      );
    } catch (error) {
      this.handleError(error, 'creditBalance');
    }
  }

  private handleError(error: unknown, operation: string): never {
    if (error instanceof Error && 'response' in error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      this.logger.warn(`HCM ${operation} failed with status ${status}`);
      if (status === 422) throw new HcmInsufficientBalanceError();
      if (status === 400 || status === 404)
        throw new HcmInvalidDimensionsError();
    }
    this.logger.error(
      `HCM ${operation} unavailable: ${(error as Error).message}`,
    );
    throw new HcmUnavailableError();
  }
}
