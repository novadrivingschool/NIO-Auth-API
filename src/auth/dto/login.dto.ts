import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
    @ApiProperty({ example: 'admin@example.com or john.doe' })
    @IsString()
    @IsNotEmpty()
    @Transform(({ value }) => String(value).trim().toLowerCase())
    email: string; // acepta email o username

    @ApiProperty({ example: 'StrongPass123', minLength: 8 })
    @IsNotEmpty()
    @MinLength(8)
    password: string;

    @IsString()
    @IsOptional()
    @Length(10, 64)
    deviceId?: string;

    @IsString()
    @IsOptional()
    @Length(1, 120)
    label?: string;

    @IsBoolean()
    @IsOptional()
    probeSocket?: boolean;

    @IsString()
    @IsOptional()
    apiUrl?: string;

    @IsString()
    @IsOptional()
    wsPath?: string;
}
