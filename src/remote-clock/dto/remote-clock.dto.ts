import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export const REMOTE_CLOCK_ACTIONS = ['CLOCK_IN', 'CLOCK_OUT', 'LUNCH_IN', 'LUNCH_OUT'] as const;
export type RemoteClockAction = (typeof REMOTE_CLOCK_ACTIONS)[number];

/** Go to lunch / Back to lunch: exigen las 3 validaciones de la app NIO (nonce del handshake). */
export const LUNCH_ACTIONS: readonly RemoteClockAction[] = ['LUNCH_IN', 'LUNCH_OUT'];

export class RemoteClockDto {
  /** Número de empleado EXTERNO (RR.HH.). Debe ser el del usuario del token. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  external_employee_number: string;

  @IsIn(REMOTE_CLOCK_ACTIONS as unknown as string[])
  action: RemoteClockAction;

  /** Nonce del handshake "misma máquina". Obligatorio en LUNCH_IN / LUNCH_OUT. */
  @IsOptional()
  @IsString()
  @Length(16, 128)
  nonce?: string;
}

/** Admin: empleado objetivo de un comando a su app (por employee_number del NIO). */
export class AdminEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employee_number: string;
}

/** Admin: pide a la app del empleado un screenshot para adjuntarlo a un registro (p. ej. el CLOCK_OUT forzado). */
export class AdminScreenshotDto extends AdminEmployeeDto {
  @IsInt()
  @Min(1)
  record_id: number;
}
