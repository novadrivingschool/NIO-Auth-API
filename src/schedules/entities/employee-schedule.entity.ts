import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { EmployeeScheduleDay } from './employee-schedule-day.entity';

export enum ScheduleType {
  /** Recurrente semana a semana, con vigencia (desde / hasta opcional). */
  FIXED = 'fixed',
  /** Un periodo concreto, de un día a otro (ej. una semana o unos días). */
  VARIABLE = 'variable',
}

/**
 * Una "versión" de horario de un usuario. Dos horarios de un mismo usuario
 * nunca se traslapan en el tiempo (lo garantiza SchedulesService dentro de una
 * transacción con bloqueo del usuario), por lo que la lista ordenada por
 * `valid_from` es el historial de qué horario aplicó en cada fecha.
 */
@Entity('employee_schedules')
@Index('IDX_employee_schedules_user_valid_from', ['userId', 'validFrom'])
export class EmployeeSchedule {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ApiProperty({ enum: ScheduleType })
  @Column({ type: 'varchar', length: 16 })
  type: ScheduleType;

  @ApiProperty({ example: '2026-11-02', description: 'Primer día de vigencia' })
  @Column({ name: 'valid_from', type: 'date' })
  validFrom: string;

  @ApiPropertyOptional({
    example: null,
    description: 'Último día de vigencia (inclusive). null = sin fecha de término',
  })
  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => EmployeeScheduleDay, (d) => d.schedule, { cascade: ['insert'] })
  days: EmployeeScheduleDay[];
}
