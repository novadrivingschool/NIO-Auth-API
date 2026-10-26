import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const REMOTE_CLOCK_ACTIONS = ['CLOCK_IN', 'CLOCK_OUT'] as const;
export type RemoteClockAction = (typeof REMOTE_CLOCK_ACTIONS)[number];

export class RemoteClockDto {
  /** Número de empleado EXTERNO (RR.HH.). Debe ser el del usuario del token. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  external_employee_number: string;

  @IsIn(REMOTE_CLOCK_ACTIONS as unknown as string[])
  action: RemoteClockAction;
}
