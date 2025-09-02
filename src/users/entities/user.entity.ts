import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToOne } from 'typeorm';
import { Exclude } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserProfile } from './user-profile.entity';

export enum Role {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  EMPLOYEE = 'employee',
  CUSTOMER = 'customer',
}

@Entity('users')
@Index(['email'], { unique: true })
export class User {
  @ApiProperty({ example: 'uuid-v4', description: 'Identificador único del usuario' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user@example.com', description: 'Correo electrónico único' })
  @Column({ length: 160 })
  email: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar' })
  passwordHash: string;

  @ApiProperty({ enum: Role, isArray: true, example: [Role.CUSTOMER] })
  @Column({ type: 'text', array: true, default: [Role.CUSTOMER] })
  roles: Role[];

  @ApiProperty({ example: true, description: 'Indica si el usuario está activo' })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Exclude()
  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  refreshTokenHash: string | null;

  @ApiProperty({ example: '2025-08-08T14:48:00Z', description: 'Fecha de creación del registro' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2025-08-08T14:48:00Z', description: 'Fecha de última actualización' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => UserProfile, p => p.user, { cascade: true })
  profile: UserProfile;
}
