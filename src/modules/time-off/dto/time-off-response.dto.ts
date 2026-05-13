export class TimeOffResponseDto {
  requestId!: string;
  employeeId!: string;
  locationId!: string;
  leaveType!: string;
  startDate!: string;
  endDate!: string;
  days!: number;
  status!: string;
  notes!: string | null;
  hcmReferenceId!: string | null;
  availableAfterReservation?: number;
  createdAt!: string;
  updatedAt!: string;
}
