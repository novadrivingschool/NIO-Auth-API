import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import {
  CAPTURE_INTERVAL_MAX_SECONDS,
  CAPTURE_INTERVAL_MIN_SECONDS,
} from '../settings.constants';

export class UpdateCaptureIntervalDto {
  @ApiProperty({
    example: 600,
    description: `Segundos entre registros de actividad/capturas. Múltiplo de 60, entre ${CAPTURE_INTERVAL_MIN_SECONDS} y ${CAPTURE_INTERVAL_MAX_SECONDS}.`,
  })
  @IsInt()
  @Min(CAPTURE_INTERVAL_MIN_SECONDS)
  @Max(CAPTURE_INTERVAL_MAX_SECONDS)
  seconds: number;
}
