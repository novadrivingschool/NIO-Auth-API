import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from 'src/users/entities/user.entity';

export type HandshakeStatus = 'pending' | 'completed' | 'timeout' | 'failed';

/** Datos de actividad del equipo en el instante del handshake (jsonb). */
export interface HandshakeActivity {
  activeMs?: number;
  inactiveMs?: number;
  running?: boolean;
  activityStatus?: string;
  clockedIn?: boolean;
  networkType?: string;
  capturedAt?: string;
}

@Entity('handshake_captures')
@Index(['targetUserId', 'requestedAt'])
export class HandshakeCapture {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'target_user_id' })
  targetUserId: string;

  // Sin FK en BD (auditoría): solo para poder hacer JOIN de nombres.
  @ManyToOne(() => User, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'target_user_id' })
  targetUser?: User;

  @Column({ name: 'target_device_id', type: 'varchar', length: 60, nullable: true })
  targetDeviceId: string | null;

  @Column('uuid', { name: 'requested_by' })
  requestedById: string;

  @ManyToOne(() => User, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'requested_by' })
  requestedBy?: User;

  @Column({ name: 'employee_number', type: 'varchar', length: 50, nullable: true })
  employeeNumber: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: HandshakeStatus;

  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'now()' })
  requestedAt: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ name: 'image_key', type: 'text', nullable: true })
  imageKey: string | null;

  @Column({ name: 'thumb_key', type: 'text', nullable: true })
  thumbKey: string | null;

  @Column({ type: 'jsonb', nullable: true })
  activity: HandshakeActivity | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
