import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class DeductBalanceDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() locationId!: string;
  @IsString()
  @IsIn(['VACATION', 'SICK', 'PERSONAL', 'OTHER'])
  @IsOptional()
  leaveType?: string;
  @IsNumber() @Min(0.5) days!: number;
}
