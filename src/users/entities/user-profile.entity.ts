// user-profile.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 👇 UserProfile es el DUEÑO (tiene la FK user_id)
  @OneToOne(() => User, (u) => u.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiPropertyOptional()
  @Column({ name: 'first_name', type: 'varchar', length: 120, nullable: true })
  firstName?: string;

  @ApiPropertyOptional()
  @Column({ name: 'last_name', type: 'varchar', length: 120, nullable: true })
  lastName?: string;

  // Fecha sola (no hora)
  @ApiPropertyOptional()
  @Column({ name: 'birthdate', type: 'date', nullable: true })
  birthdate?: string; // 'YYYY-MM-DD'

  @ApiPropertyOptional()
  @Column({ name: 'phone', type: 'varchar', length: 40, nullable: true })
  phone?: string;

  @Index({ unique: true, where: 'user_name IS NOT NULL' })
  @ApiPropertyOptional()
  @Column({ name: 'user_name', type: 'varchar', length: 200, nullable: true })
  userName?: string;

  @ApiPropertyOptional()
  @Column({ name: 'gender', type: 'varchar', length: 16, nullable: true })
  gender?: string;

  @ApiPropertyOptional()
  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl?: string;

  // Campos flexibles
  @ApiPropertyOptional()
  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Index('UQ_user_profiles_employee_number', {
    unique: true,
    where: 'employee_number IS NOT NULL',
  })
  @ApiPropertyOptional()
  @Column({
    name: 'employee_number',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  employee_number?: string;

  // Número de empleado EXTERNO (app de RR.HH.). Aparte del employee_number del NIO.
  @Index('UQ_user_profiles_external_employee_number', {
    unique: true,
    where: 'external_employee_number IS NOT NULL',
  })
  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'external_employee_number',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  external_employee_number?: string | null;

  /**
   * Modo vinculado: NIO y Activity Report se usan en conjunto. Con true, el clock manual de la app
   * NIO se deshabilita y el Activity solo hace clock in/out con el socket de la app activo.
   */
  @ApiPropertyOptional({ default: false })
  @Column({ name: 'activity_linked', type: 'boolean', default: false })
  activity_linked: boolean;

  /**
   * SOLO desarrollo/pruebas: muestra en la app NIO de este usuario el bot que simula actividad
   * (para probar el monitor). Solo lo cambia un super_admin y solo con DEV_ACTIVITY_BOT=true.
   */
  @ApiPropertyOptional({ default: false })
  @Column({ name: 'dev_activity_bot', type: 'boolean', default: false })
  dev_activity_bot: boolean;
}
