import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScheduleType } from '../entities/employee-schedule.entity';
import { MAX_VARIABLE_DAYS } from '../schedule-rules';

/** Un variable lleva una fila por fecha (≤ 92); un fijo, a lo sumo 7. */
const MAX_SCHEDULE_DAYS = MAX_VARIABLE_DAYS;

export const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const TIME_MESSAGE = 'must be a time in HH:mm (24h) format';
const DATE_MESSAGE = 'must be a date in YYYY-MM-DD format';

export class ScheduleDayDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'fixed: ISO 1 = lunes … 7 = domingo (obligatorio). variable: se ignora, se deriva de `date`.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number;

  @ApiPropertyOptional({
    example: '2026-10-28',
    description:
      'variable: fecha concreta del bloque, dentro de la vigencia (obligatorio). fixed: no se envía.',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: `date ${DATE_MESSAGE}` })
  date?: string;

  @ApiProperty({ example: '09:00' })
  @Matches(TIME_24H, { message: `startTime ${TIME_MESSAGE}` })
  startTime: string;

  @ApiProperty({ example: '18:00' })
  @Matches(TIME_24H, { message: `endTime ${TIME_MESSAGE}` })
  endTime: string;

  @ApiPropertyOptional({ example: '14:00', nullable: true })
  @IsOptional()
  @Matches(TIME_24H, { message: `lunchStart ${TIME_MESSAGE}` })
  lunchStart?: string | null;

  @ApiPropertyOptional({ example: '15:00', nullable: true })
  @IsOptional()
  @Matches(TIME_24H, { message: `lunchEnd ${TIME_MESSAGE}` })
  lunchEnd?: string | null;
}

export class CreateScheduleDto {
  @ApiProperty({
    enum: ScheduleType,
    description:
      'fixed = recurrente con vigencia; variable = un periodo concreto (desde un día hasta otro)',
  })
  @IsEnum(ScheduleType)
  type: ScheduleType;

  @ApiProperty({
    example: '2026-11-02',
    description: 'Primer día de vigencia (cualquier día).',
  })
  @Matches(ISO_DATE, { message: `validFrom ${DATE_MESSAGE}` })
  validFrom: string;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description:
      'Último día de vigencia (inclusive). fixed: opcional (null = sin término). variable: obligatorio, máx. 92 días.',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: `validTo ${DATE_MESSAGE}` })
  validTo?: string | null;

  @ApiProperty({
    type: [ScheduleDayDto],
    description:
      'fixed: bloques por día de la semana (ISO 1–7). variable: un bloque por fecha (`date`) dentro de la vigencia, cada uno con su horario. Lo que no aparezca es descanso.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SCHEDULE_DAYS)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days: ScheduleDayDto[];

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Solo type=fixed: si el horario fijo vigente se traslapa, lo cierra el día anterior a validFrom en vez de rechazar.',
  })
  @IsOptional()
  @IsBoolean()
  closePrevious?: boolean;
}

/** El tipo no se puede cambiar: se borra (si no ha iniciado) y se crea otro. */
export class UpdateScheduleDto {
  @ApiPropertyOptional({ example: '2026-11-02' })
  @IsOptional()
  @Matches(ISO_DATE, { message: `validFrom ${DATE_MESSAGE}` })
  validFrom?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    nullable: true,
    description: 'null = sin fecha de término (solo fixed)',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: `validTo ${DATE_MESSAGE}` })
  validTo?: string | null;

  @ApiPropertyOptional({ type: [ScheduleDayDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SCHEDULE_DAYS)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days?: ScheduleDayDto[];

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class ListSchedulesQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(ISO_DATE, { message: `from ${DATE_MESSAGE}` })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(ISO_DATE, { message: `to ${DATE_MESSAGE}` })
  to?: string;

  @ApiPropertyOptional({ enum: ScheduleType })
  @IsOptional()
  @IsEnum(ScheduleType)
  type?: ScheduleType;
}

export class ScheduleHistoryQueryDto {
  @ApiPropertyOptional({ example: 100, description: 'Máximo 200' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filtra por un horario concreto' })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  scheduleId?: string;
}
