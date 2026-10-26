import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Lo que reporta el dispositivo al responder un handshake. */
export class HandshakeResultDto {
  @ApiPropertyOptional({ description: 'Key S3 de la captura' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageKey?: string;

  @ApiPropertyOptional({ description: 'Key S3 de la miniatura' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employeeNumber?: string;

  @ApiPropertyOptional({ description: 'Actividad del equipo en ese instante' })
  @IsOptional()
  @IsObject()
  activity?: Record<string, unknown>;
}

export class HandshakeFailDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}
