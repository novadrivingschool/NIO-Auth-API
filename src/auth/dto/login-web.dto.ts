import { IsNotEmpty, IsString, Length, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Login exclusivo del front web (Vue). Identifica por employee_number.
 *
 * Deliberadamente NO acepta deviceId/label: la sesión de escritorio se maneja
 * en `POST /auth/login` (Electron) con su propio ciclo de vida basado en
 * auth_sessions. Separar los contratos evita que un cambio en el login web
 * rompa el desktop.
 */
export class LoginWebDto {
  @ApiProperty({ example: 'NIOJD483920', description: 'Employee number' })
  @IsString()
  @IsNotEmpty()
  @Length(5, 16)
  @Transform(({ value }) => String(value).trim().toUpperCase())
  employeeNumber: string;

  @ApiProperty({ example: 'StrongPass123', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
