import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeSchedule } from './employee-schedule.entity';

/** Postgres devuelve `time` como 'HH:mm:ss'; la API trabaja con 'HH:mm'. */
const TIME_HHMM: ValueTransformer = {
  to: (value?: string | null) => value ?? null,
  from: (value?: string | null) => (value ? String(value).slice(0, 5) : null),
};

@Entity('employee_schedule_days')
// fixed: un bloque por día de la semana (date = null).
@Index('UQ_employee_schedule_days_schedule_weekday', ['scheduleId', 'weekday'], {
  unique: true,
  where: '"date" IS NULL',
})
// variable: un bloque por fecha concreta.
@Index('UQ_employee_schedule_days_schedule_date', ['scheduleId', 'date'], {
  unique: true,
  where: '"date" IS NOT NULL',
})
export class EmployeeScheduleDay {
  @Exclude()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Exclude()
  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @Exclude()
  @ManyToOne(() => EmployeeSchedule, (s) => s.days, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule?: EmployeeSchedule;

  @ApiProperty({ example: 1, description: 'ISO: 1 = lunes … 7 = domingo' })
  @Column({ type: 'smallint' })
  weekday: number;

  @ApiPropertyOptional({
    example: '2026-10-28',
    nullable: true,
    description:
      'Solo en horarios variable: la fecha concreta del bloque. En fixed es null.',
  })
  @Column({ type: 'date', nullable: true })
  date: string | null;

  @ApiProperty({ example: '09:00' })
  @Column({ name: 'start_time', type: 'time', transformer: TIME_HHMM })
  startTime: string;

  @ApiProperty({ example: '18:00' })
  @Column({ name: 'end_time', type: 'time', transformer: TIME_HHMM })
  endTime: string;

  @ApiPropertyOptional({ example: '14:00' })
  @Column({
    name: 'lunch_start',
    type: 'time',
    nullable: true,
    transformer: TIME_HHMM,
  })
  lunchStart: string | null;

  @ApiPropertyOptional({ example: '15:00' })
  @Column({
    name: 'lunch_end',
    type: 'time',
    nullable: true,
    transformer: TIME_HHMM,
  })
  lunchEnd: string | null;
}
