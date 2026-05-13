import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('locations')
export class Location {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @CreateDateColumn({ type: 'text' })
  createdAt!: string;
}
