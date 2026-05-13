import { DataSource } from 'typeorm';
import { Employee } from '../../src/modules/balance/entities/employee.entity';
import { Location } from '../../src/modules/balance/entities/location.entity';
import { LeaveBalance } from '../../src/modules/balance/entities/leave-balance.entity';

export interface SeedOptions {
  hcmBalance?: number;
  pendingDays?: number;
  employeeId?: string;
  locationId?: string;
  leaveType?: string;
}

export interface SeedResult {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balanceId: string;
}

export async function seedBaseline(
  dataSource: DataSource,
  opts: SeedOptions = {},
): Promise<SeedResult> {
  const employeeId = opts.employeeId ?? 'EMP-1';
  const locationId = opts.locationId ?? 'LOC-1';
  const leaveType = opts.leaveType ?? 'VACATION';

  await dataSource.manager.upsert(
    Employee,
    { id: employeeId, name: `Test Employee ${employeeId}` },
    ['id'],
  );

  await dataSource.manager.upsert(
    Location,
    { id: locationId, name: `Test Location ${locationId}` },
    ['id'],
  );

  const existing = await dataSource.manager.findOne(LeaveBalance, {
    where: { employeeId, locationId, leaveType },
  });

  let balanceId: string;
  if (existing) {
    balanceId = existing.id;
    await dataSource.manager.update(LeaveBalance, existing.id, {
      hcmBalance: opts.hcmBalance ?? 10,
      pendingDays: opts.pendingDays ?? 0,
      version: 1,
      hcmLastSyncedAt: null,
    });
  } else {
    balanceId = crypto.randomUUID();
    await dataSource.manager.save(LeaveBalance, {
      id: balanceId,
      employeeId,
      locationId,
      leaveType,
      hcmBalance: opts.hcmBalance ?? 10,
      pendingDays: opts.pendingDays ?? 0,
      version: 1,
      hcmLastSyncedAt: null,
    });
  }

  return { employeeId, locationId, leaveType, balanceId };
}

export async function resetSchema(dataSource: DataSource): Promise<void> {
  await dataSource.synchronize(true);
}
