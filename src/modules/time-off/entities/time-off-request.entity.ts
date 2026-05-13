import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

@Entity('time_off_requests')
export class TimeOffRequest {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Index()
  @Column({ type: 'text', name: 'employee_id' })
  employeeId!: string;

  @Column({ type: 'text', name: 'location_id' })
  locationId!: string;

  @Column({ type: 'text', name: 'leave_type', default: 'VACATION' })
  leaveType!: string;

  @Column({ type: 'text', name: 'start_date' })
  startDate!: string;

  @Column({ type: 'text', name: 'end_date' })
  endDate!: string;

  @Column({ type: 'real' })
  days!: number;

  @Index()
  @Column({ type: 'text', default: RequestStatus.PENDING })
  status!: RequestStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'text', name: 'hcm_reference_id', nullable: true })
  hcmReferenceId!: string | null;

  @Column({ type: 'text', name: 'hcm_submitted_at', nullable: true })
  hcmSubmittedAt!: string | null;

  @Index({ unique: true })
  @Column({ type: 'text', name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ type: 'text', name: 'created_at' })
  createdAt!: string;

  @UpdateDateColumn({ type: 'text', name: 'updated_at' })
  updatedAt!: string;
}
