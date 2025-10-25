import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index
} from 'typeorm'
import { User } from './user.entity'

export type ClientKind = 'electron' | 'web' | 'mobile'

@Entity('auth_sessions')
@Index(['userId', 'client'], { unique: true })
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column('uuid', { name: 'user_id' })
  userId: string

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User

  // 👇 especifica type para evitar inferencia
  @Column({ name: 'client', type: 'varchar', length: 20, default: 'electron' })
  client: ClientKind

  @Column({ name: 'device_id', type: 'varchar', length: 60 })
  deviceId: string

  // ❌ string | null  →  ✅ string con nullable: true + type
  @Column({ name: 'label', type: 'varchar', length: 120, nullable: true })
  label?: string | null

  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  refreshTokenHash: string | null

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
