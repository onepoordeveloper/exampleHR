import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('leave_balances')
@Index(['employeeId', 'locationId', 'leaveType'], { unique: true })
export class LeaveBalance {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text', name: 'employee_id' })
  employeeId!: string;

  @Column({ type: 'text', name: 'location_id' })
  locationId!: string;

  @Column({ type: 'text', name: 'leave_type', default: 'VACATION' })
  leaveType!: string;

  @Column({ type: 'real', name: 'hcm_balance', default: 0 })
  hcmBalance!: number;

  @Column({ type: 'real', name: 'pending_days', default: 0 })
  pendingDays!: number;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'text', name: 'hcm_last_synced_at', nullable: true })
  hcmLastSyncedAt!: string | null;

  @CreateDateColumn({ type: 'text', name: 'created_at' })
  createdAt!: string;

  @UpdateDateColumn({ type: 'text', name: 'updated_at' })
  updatedAt!: string;
}
