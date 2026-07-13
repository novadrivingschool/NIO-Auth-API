import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
    @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
    @IsNotEmpty()
    refreshToken: string;

    @ApiPropertyOptional({
        example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        description:
            'Device binding (Electron): si viene y no coincide con la sesión, se revoca (DEVICE_MISMATCH).',
    })
    @IsOptional()
    @IsString()
    @Length(10, 64)
    deviceId?: string;
}
