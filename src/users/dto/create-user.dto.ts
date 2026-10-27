import {
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsString,
  IsDateString,
  IsUrl,
  IsObject,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../entities/user.entity';

export class CreateUserProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthdate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() avatarUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() userName?: string;
  @ApiPropertyOptional({
    example: '48213',
    nullable: true,
    description:
      'Número de empleado EXTERNO (app de RR.HH.). Manual, opcional y único; vacío lo borra. No es el employee_number del NIO.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(50)
  external_employee_number?: string | null;
  @ApiPropertyOptional({
    default: false,
    description:
      'Modo vinculado NIO + Activity Report: deshabilita el clock manual de la app NIO y exige el socket activo en el Activity.',
  })
  @IsOptional()
  @IsBoolean()
  activity_linked?: boolean;
  @ApiPropertyOptional({
    default: false,
    description:
      'SOLO desarrollo/pruebas: muestra el bot de actividad en la app NIO del usuario. Solo super_admin y con DEV_ACTIVITY_BOT=true en el API.',
  })
  @IsOptional()
  @IsBoolean()
  dev_activity_bot?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<
    string,
    any
  >;
}

export class CreateUserDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  email?: string;

  @ApiProperty({ minLength: 8, example: 'StrongPass123' })
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  // @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, { message: 'Password must include upper, lower and number' })
  password: string;

  @ApiPropertyOptional({ enum: Role, isArray: true, example: ['admin'] })
  @IsOptional()
  @IsEnum(Role, { each: true })
  roles?: Role[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: CreateUserProfileDto })
  @IsOptional()
  profile?: CreateUserProfileDto;
}
