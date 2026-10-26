import { BadRequestException } from '@nestjs/common';
import { ScheduleType } from './entities/employee-schedule.entity';
import {
  daysBetweenInclusive,
  isIsoDate,
  isoWeekday,
  weekdaysInRange,
} from './schedule-dates.util';

export interface DayInput {
  weekday?: number;
  date?: string | null;
  startTime: string;
  endTime: string;
  lunchStart?: string | null;
  lunchEnd?: string | null;
}

export interface NormalizedDay {
  weekday: number;
  /** null en fixed; fecha concreta en variable. */
  date: string | null;
  startTime: string;
  endTime: string;
  lunchStart: string | null;
  lunchEnd: string | null;
}

export interface ScheduleWindow {
  validFrom: string;
  validTo: string | null;
}

/** Rango razonable: detecta typos como 0206-10-26 o 2062-10-26. */
const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';

/** Un horario variable cubre un periodo corto; el largo plazo es el fijo. */
export const MAX_VARIABLE_DAYS = 92;

const WEEKDAY_NAMES = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/**
 * Valida y normaliza los bloques. Las horas son 'HH:mm' con cero a la izquierda,
 * por lo que la comparación de strings equivale a la cronológica. No se admiten
 * turnos que cruzan la medianoche.
 *  - fixed: un bloque por día de la semana (`weekday`), sin `date`.
 *  - variable: un bloque por fecha (`date`); el `weekday` se deriva de la fecha.
 */
export function normalizeDays(
  days: DayInput[],
  type: ScheduleType,
): NormalizedDay[] {
  const seen = new Set<string | number>();

  const normalized = days.map((day): NormalizedDay => {
    let weekday: number;
    let date: string | null;
    let name: string;

    if (type === ScheduleType.VARIABLE) {
      if (!day.date || !isIsoDate(day.date)) {
        throw new BadRequestException(
          'Each day of a variable schedule needs a valid date (YYYY-MM-DD)',
        );
      }
      date = day.date;
      weekday = isoWeekday(date);
      name = `${WEEKDAY_NAMES[weekday]} ${date}`;
    } else {
      if (day.date) {
        throw new BadRequestException(
          'A fixed schedule is defined by weekday, not by date',
        );
      }
      if (!Number.isInteger(day.weekday) || day.weekday! < 1 || day.weekday! > 7) {
        throw new BadRequestException(
          'Each day of a fixed schedule needs a weekday between 1 and 7',
        );
      }
      date = null;
      weekday = day.weekday!;
      name = WEEKDAY_NAMES[weekday];
    }

    const key = date ?? weekday;
    if (seen.has(key)) {
      throw new BadRequestException(`${name} appears more than once`);
    }
    seen.add(key);

    if (day.endTime <= day.startTime) {
      throw new BadRequestException(
        `${name}: end time must be after start time`,
      );
    }

    const lunchStart = day.lunchStart ?? null;
    const lunchEnd = day.lunchEnd ?? null;

    if ((lunchStart === null) !== (lunchEnd === null)) {
      throw new BadRequestException(
        `${name}: lunch needs both a start and an end (or neither)`,
      );
    }

    if (lunchStart !== null && lunchEnd !== null) {
      if (lunchEnd <= lunchStart) {
        throw new BadRequestException(
          `${name}: lunch end must be after lunch start`,
        );
      }
      if (lunchStart <= day.startTime || lunchEnd >= day.endTime) {
        throw new BadRequestException(
          `${name}: lunch must fall inside the working hours`,
        );
      }
    }

    return {
      weekday,
      date,
      startTime: day.startTime,
      endTime: day.endTime,
      lunchStart,
      lunchEnd,
    };
  });

  return normalized.sort(compareDays);
}

/** fixed por día de la semana; variable cronológico por fecha. */
export function compareDays(
  a: Pick<NormalizedDay, 'weekday' | 'date'>,
  b: Pick<NormalizedDay, 'weekday' | 'date'>,
): number {
  if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  return a.weekday - b.weekday;
}

/**
 * Resuelve la vigencia según el tipo:
 *  - fixed: recurrente; `validTo` opcional (null = sin fecha de término).
 *  - variable: periodo concreto desde un día hasta otro (cualquier día, sin
 *    forzar lunes→domingo); `validTo` es obligatorio y el periodo es corto.
 */
export function resolveWindow(
  type: ScheduleType,
  validFrom: string,
  validTo: string | null | undefined,
): ScheduleWindow {
  if (!isIsoDate(validFrom)) {
    throw new BadRequestException('validFrom must be a valid date (YYYY-MM-DD)');
  }
  if (validFrom < MIN_DATE || validFrom > MAX_DATE) {
    throw new BadRequestException('validFrom is out of the supported range');
  }

  if (validTo === undefined || validTo === null) {
    if (type === ScheduleType.VARIABLE) {
      throw new BadRequestException('A variable schedule needs an end date');
    }
    return { validFrom, validTo: null };
  }

  if (!isIsoDate(validTo)) {
    throw new BadRequestException('validTo must be a valid date (YYYY-MM-DD)');
  }
  if (validTo < validFrom) {
    throw new BadRequestException('validTo cannot be before validFrom');
  }
  if (validTo > MAX_DATE) {
    throw new BadRequestException('validTo is out of the supported range');
  }
  if (
    type === ScheduleType.VARIABLE &&
    daysBetweenInclusive(validFrom, validTo) > MAX_VARIABLE_DAYS
  ) {
    throw new BadRequestException(
      `A variable schedule can cover at most ${MAX_VARIABLE_DAYS} days`,
    );
  }
  return { validFrom, validTo };
}

/**
 * Los bloques deben caer dentro del periodo.
 *  - variable: cada `date` debe estar entre validFrom y validTo.
 *  - fixed con término: el día de la semana debe ocurrir en el periodo.
 *    Con `validTo` abierto cualquier día es válido.
 */
export function assertDaysWithinWindow(
  days: Pick<NormalizedDay, 'weekday' | 'date'>[],
  window: ScheduleWindow,
): void {
  if (window.validTo === null) return;
  const allowed = weekdaysInRange(window.validFrom, window.validTo);
  for (const day of days) {
    if (day.date) {
      if (day.date < window.validFrom || day.date > window.validTo) {
        throw new BadRequestException(
          `${day.date} is outside the period ${window.validFrom} → ${window.validTo}`,
        );
      }
    } else if (!allowed.has(day.weekday)) {
      throw new BadRequestException(
        `${WEEKDAY_NAMES[day.weekday] ?? `Day ${day.weekday}`} does not occur between ${window.validFrom} and ${window.validTo}`,
      );
    }
  }
}

/** `null` representa "sin fecha de término" (infinito). */
export function endsNoLaterThan(a: string | null, b: string | null): boolean {
  if (b === null) return true;
  if (a === null) return false;
  return a <= b;
}
