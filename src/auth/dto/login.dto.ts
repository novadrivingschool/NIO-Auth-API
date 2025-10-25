import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
    @ApiProperty({ example: 'admin@example.com' })
    @IsEmail()
    @Transform(({ value }) => String(value).trim().toLowerCase())
    email: string;

    @ApiProperty({ example: 'StrongPass123', minLength: 8 })
    @IsNotEmpty()
    @MinLength(8)
    password: string;

    // 👇 Opcionales: si vienen, se trata como login de Electron
    @IsString()
    @IsOptional()
    @Length(10, 64)
    deviceId?: string

    @IsString()
    @IsOptional()
    @Length(1, 120)
    label?: string

    // 🔧 solo para pruebas en dev: pedir que el login también “abra el socket”
    @IsBoolean()
    @IsOptional()
    probeSocket?: boolean;

    // override del URL del backend para el probe (si no, se toma de ConfigService)
    @IsString()
    @IsOptional()
    apiUrl?: string;

    // path del gateway (por defecto '/ws')
    @IsString()
    @IsOptional()
    wsPath?: string;
}
