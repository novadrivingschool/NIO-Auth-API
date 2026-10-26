/**
 * Utilidades de fechas calendario ('YYYY-MM-DD') sin hora ni zona.
 *
 * Todo se calcula en UTC sobre la fecha pura para que el resultado no dependa
 * de la zona horaria del servidor ni de cambios de horario de verano.
 */

/** Los horarios se capturan y se interpretan siempre en hora de Chicago. */
export const SCHEDULE_TIME_ZONE = 'America/Chicago';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Rechaza fechas inexistentes como 2026-02-30 (JS las "desborda").
  return formatIsoDate(date) === value;
}

function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function isMonday(value: string): boolean {
  return parseIsoDate(value).getUTCDay() === 1;
}

/** Días calendario entre dos fechas, ambas inclusive (mismo día = 1). */
export function daysBetweenInclusive(from: string, to: string): number {
  const ms = parseIsoDate(to).getTime() - parseIsoDate(from).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha calendario. */
export function isoWeekday(value: string): number {
  const jsDay = parseIsoDate(value).getUTCDay(); // 0 = domingo
  return jsDay === 0 ? 7 : jsDay;
}

/** Días de la semana ISO (1 = lunes … 7 = domingo) que ocurren en [from, to]. */
export function weekdaysInRange(from: string, to: string): Set<number> {
  const found = new Set<number>();
  const total = Math.min(daysBetweenInclusive(from, to), 7);
  for (let i = 0; i < total; i++) {
    const jsDay = parseIsoDate(addDays(from, i)).getUTCDay(); // 0 = domingo
    found.add(jsDay === 0 ? 7 : jsDay);
  }
  return found;
}

/** Fecha de hoy ('YYYY-MM-DD') en la zona de los horarios. */
export function todayInScheduleZone(now: Date = new Date()): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
