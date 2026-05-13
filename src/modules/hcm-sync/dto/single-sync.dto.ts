import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class SingleSyncDto {
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

  @IsString()
  @IsIn(['ANNIVERSARY_BONUS', 'MANUAL_CORRECTION', 'YEAR_REFRESH', 'OTHER'])
  @IsOptional()
  reason?: string;
}
