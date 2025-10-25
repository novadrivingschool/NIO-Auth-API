// user-profile.entity.ts
import {
    Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn,
    CreateDateColumn, UpdateDateColumn
} from 'typeorm';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('user_profiles')
export class UserProfile {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    // 👇 UserProfile es el DUEÑO (tiene la FK user_id)
    @OneToOne(() => User, u => u.profile, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @ApiPropertyOptional() @Column({ name: 'first_name', type: 'varchar', length: 120, nullable: true })
    firstName?: string;

    @ApiPropertyOptional() @Column({ name: 'last_name', type: 'varchar', length: 120, nullable: true })
    lastName?: string;

    // Fecha sola (no hora)
    @ApiPropertyOptional() @Column({ name: 'birthdate', type: 'date', nullable: true })
    birthdate?: string; // 'YYYY-MM-DD'

    @ApiPropertyOptional() @Column({ name: 'phone', type: 'varchar', length: 40, nullable: true })
    phone?: string;

    @ApiPropertyOptional() 
    @Column({ name: 'gender', type: 'varchar', length: 16, nullable: true })
    gender?: string;

    @ApiPropertyOptional() 
    @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
    avatarUrl?: string;

    // Campos flexibles
    @ApiPropertyOptional() @Column({ name: 'metadata', type: 'jsonb', nullable: true })
    metadata?: Record<string, any>;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;

    @ApiPropertyOptional() 
    @Column({ name: 'employee_number', type: 'varchar', length: 16, nullable: true })
    employee_number?: string;
}
