import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'endDateAfterStart', async: false })
class EndDateAfterStartConstraint implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments): boolean {
    const obj = args.object as CreateTimeOffRequestDto;
    if (!obj.startDate || !endDate) return true;
    return endDate >= obj.startDate;
  }
  defaultMessage(): string {
    return 'endDate must be on or after startDate';
  }
}

function EndDateAfterStart(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: EndDateAfterStartConstraint,
    });
  };
}

export class CreateTimeOffRequestDto {
  @ApiProperty({ example: 'EMP-1' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: 'LOC-1' })
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @ApiPropertyOptional({
    enum: ['VACATION', 'SICK', 'PERSONAL', 'OTHER'],
    default: 'VACATION',
  })
  @IsString()
  @IsIn(['VACATION', 'SICK', 'PERSONAL', 'OTHER'])
  @IsOptional()
  leaveType?: string = 'VACATION';

  @ApiProperty({ example: '2026-06-01', description: 'ISO-8601 date' })
  @IsISO8601()
  startDate!: string;

  @ApiProperty({
    example: '2026-06-03',
    description: 'ISO-8601 date, must be >= startDate',
  })
  @IsISO8601()
  @EndDateAfterStart()
  endDate!: string;

  @ApiProperty({
    example: 2,
    description: 'Number of leave days requested (min 0.5)',
  })
  @IsNumber()
  @Min(0.5)
  days!: number;

  @ApiPropertyOptional({ example: 'Family vacation' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
