import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

export type ScheduleRevisionAction =
  | 'created'
  | 'updated'
  | 'closed'
  | 'deleted';

/**
 * Bitácora de auditoría: una fila por cada alta, edición, cierre o borrado de
 * un horario, con el estado completo resultante. `schedule_id` no tiene FK a
 * propósito: el rastro de un horario borrado debe sobrevivir.
 */
@Entity('employee_schedule_revisions')
@Index('IDX_employee_schedule_revisions_user_changed_at', ['userId', 'changedAt'])
export class EmployeeScheduleRevision {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ApiProperty({ enum: ['created', 'updated', 'closed', 'deleted'] })
  @Column({ type: 'varchar', length: 16 })
  action: ScheduleRevisionAction;

  @ApiProperty({ description: 'Estado completo del horario tras la acción' })
  @Column({ type: 'jsonb' })
  snapshot: Record<string, unknown>;

  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy: string | null;

  @ApiProperty()
  @Column({
    name: 'changed_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  changedAt: Date;
}
