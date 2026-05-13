export class BalanceResponseDto {
  locationId!: string;
  leaveType!: string;
  hcmBalance!: number;
  pendingDays!: number;
  availableDays!: number;
  lastSyncedAt!: string | null;
}
