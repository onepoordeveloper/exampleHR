import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('balance_audit_logs')
export class BalanceAuditLog {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text', name: 'employee_id' })
  employeeId!: string;

  @Column({ type: 'text', name: 'location_id' })
  locationId!: string;

  @Column({ type: 'text', name: 'leave_type' })
  leaveType!: string;

  @Column({ type: 'text' })
  source!: string;

  @Column({ type: 'real', name: 'prev_hcm_balance', nullable: true })
  prevHcmBalance!: number | null;

  @Column({ type: 'real', name: 'new_hcm_balance', nullable: true })
  newHcmBalance!: number | null;

  @Column({ type: 'real', name: 'prev_pending', nullable: true })
  prevPending!: number | null;

  @Column({ type: 'real', name: 'new_pending', nullable: true })
  newPending!: number | null;

  @Index()
  @Column({ type: 'text', name: 'reference_id', nullable: true })
  referenceId!: string | null;

  @CreateDateColumn({ type: 'text', name: 'created_at' })
  createdAt!: string;
}
