import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreditBalanceDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() locationId!: string;
  @IsString()
  @IsIn(['VACATION', 'SICK', 'PERSONAL', 'OTHER'])
  @IsOptional()
  leaveType?: string;
  @IsNumber() @Min(0) days!: number;
  @IsString() @IsOptional() originalReferenceId?: string;
}
