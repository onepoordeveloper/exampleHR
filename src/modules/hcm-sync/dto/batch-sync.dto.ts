import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class BalanceEntryDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsString()
  @IsIn(['VACATION', 'SICK', 'PERSONAL', 'OTHER'])
  @IsOptional()
  leaveType?: string = 'VACATION';

  @IsNumber()
  @Min(0)
  availableBalance!: number;
}

export class BatchSyncDto {
  @IsUUID()
  batchId!: string;

  @IsISO8601()
  syncedAt!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceEntryDto)
  balances!: BalanceEntryDto[];
}
