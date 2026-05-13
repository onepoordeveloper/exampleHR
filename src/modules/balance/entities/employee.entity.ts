import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('employees')
export class Employee {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @CreateDateColumn({ type: 'text' })
  createdAt!: string;
}
