import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
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
}
