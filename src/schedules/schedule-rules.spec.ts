import { BadRequestException } from '@nestjs/common';
import { ScheduleType } from './entities/employee-schedule.entity';
import {
  addDays,
  daysBetweenInclusive,
  isIsoDate,
  isMonday,
  isoWeekday,
  todayInScheduleZone,
  weekdaysInRange,
} from './schedule-dates.util';
import {
  assertDaysWithinWindow,
  endsNoLaterThan,
  normalizeDays,
  resolveWindow,
} from './schedule-rules';

describe('schedule-dates.util', () => {
  it('isIsoDate rechaza fechas inexistentes y formatos raros', () => {
    expect(isIsoDate('2026-10-26')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-10-2026')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it('addDays cruza mes y año sin depender de la zona horaria', () => {
    expect(addDays('2026-10-26', 6)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('isMonday', () => {
    expect(isMonday('2026-10-26')).toBe(true);
    expect(isMonday('2026-10-27')).toBe(false);
  });

  it('daysBetweenInclusive cuenta ambos extremos', () => {
    expect(daysBetweenInclusive('2026-10-28', '2026-10-28')).toBe(1);
    expect(daysBetweenInclusive('2026-10-28', '2026-11-03')).toBe(7);
  });

  it('weekdaysInRange devuelve solo los días ISO que ocurren', () => {
    // mié 28 → vie 30 oct 2026
    expect([...weekdaysInRange('2026-10-28', '2026-10-30')].sort()).toEqual([3, 4, 5]);
    // 7+ días cubren toda la semana
    expect(weekdaysInRange('2026-10-28', '2026-11-10').size).toBe(7);
    // domingo se reporta como 7
    expect(weekdaysInRange('2026-11-01', '2026-11-01')).toEqual(new Set([7]));
  });

  it('todayInScheduleZone usa hora de Chicago, no UTC', () => {
    // 03:00Z del 26 = 22:00 del 25 en Chicago (CDT).
    expect(todayInScheduleZone(new Date('2026-10-26T03:00:00Z'))).toBe('2026-10-25');
    expect(todayInScheduleZone(new Date('2026-10-26T12:00:00Z'))).toBe('2026-10-26');
  });
});

describe('isoWeekday', () => {
  it('lunes = 1 … domingo = 7', () => {
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-11-01')).toBe(7);
  });
});

describe('normalizeDays', () => {
  it('acepta fijo 09:00-18:00 con lunch 14:00-15:00 y ordena por día', () => {
    const result = normalizeDays([
      { weekday: 2, startTime: '09:00', endTime: '18:00', lunchStart: '14:00', lunchEnd: '15:00' },
      { weekday: 1, startTime: '09:00', endTime: '18:00', lunchStart: '14:00', lunchEnd: '15:00' },
    ], ScheduleType.FIXED);
    expect(result.map((d) => d.weekday)).toEqual([1, 2]);
    expect(result.every((d) => d.date === null)).toBe(true);
    expect(result[0]).toMatchObject({ lunchStart: '14:00', lunchEnd: '15:00' });
  });

  it('acepta variable por fecha: dos semanas con horarios distintos, derivando el día', () => {
    const week1 = ['2026-10-26', '2026-10-27', '2026-10-28'].map((date) => ({ date, startTime: '12:00', endTime: '18:00' }));
    const week2 = ['2026-11-02', '2026-11-03'].map((date) => ({
      date, startTime: '09:00', endTime: '18:00', lunchStart: '14:00', lunchEnd: '15:00',
    }));
    const result = normalizeDays([...week2, ...week1], ScheduleType.VARIABLE);
    expect(result.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-11-02', '2026-11-03']);
    // el mismo día de la semana puede tener horario distinto en cada semana
    expect(result.map((d) => d.weekday)).toEqual([1, 2, 3, 1, 2]);
    expect(result[0].lunchStart).toBeNull();
    expect(result[3].lunchEnd).toBe('15:00');
  });

  it('variable: exige fecha válida y no repetida; fixed no admite fecha', () => {
    const block = { startTime: '09:00', endTime: '18:00' };
    expect(() => normalizeDays([{ ...block } as any], ScheduleType.VARIABLE)).toThrow(BadRequestException);
    expect(() => normalizeDays([{ ...block, date: '2026-02-30' }], ScheduleType.VARIABLE)).toThrow(BadRequestException);
    expect(() => normalizeDays([{ ...block, date: '2026-10-26' }, { ...block, date: '2026-10-26' }], ScheduleType.VARIABLE)).toThrow(BadRequestException);
    expect(() => normalizeDays([{ ...block, weekday: 1, date: '2026-10-26' }], ScheduleType.FIXED)).toThrow(BadRequestException);
    expect(() => normalizeDays([{ ...block }], ScheduleType.FIXED)).toThrow(BadRequestException);
    expect(() => normalizeDays([{ ...block, weekday: 8 }], ScheduleType.FIXED)).toThrow(BadRequestException);
  });

  it.each([
    ['día duplicado', [{ weekday: 1, startTime: '09:00', endTime: '10:00' }, { weekday: 1, startTime: '11:00', endTime: '12:00' }]],
    ['fin <= inicio', [{ weekday: 1, startTime: '10:00', endTime: '10:00' }]],
    ['lunch incompleto', [{ weekday: 1, startTime: '09:00', endTime: '18:00', lunchStart: '14:00' }]],
    ['lunch invertido', [{ weekday: 1, startTime: '09:00', endTime: '18:00', lunchStart: '15:00', lunchEnd: '14:00' }]],
    ['lunch fuera del horario', [{ weekday: 1, startTime: '09:00', endTime: '13:00', lunchStart: '14:00', lunchEnd: '15:00' }]],
    ['lunch pegado al inicio', [{ weekday: 1, startTime: '09:00', endTime: '18:00', lunchStart: '09:00', lunchEnd: '10:00' }]],
  ])('rechaza %s', (_name, days) => {
    expect(() => normalizeDays(days as any, ScheduleType.FIXED)).toThrow(BadRequestException);
  });
});

describe('resolveWindow', () => {
  it('fixed: sin fecha de término queda abierto', () => {
    expect(resolveWindow(ScheduleType.FIXED, '2026-11-02', undefined)).toEqual({
      validFrom: '2026-11-02', validTo: null,
    });
    expect(resolveWindow(ScheduleType.FIXED, '2026-11-02', null).validTo).toBeNull();
  });

  it('fixed: valida validTo >= validFrom', () => {
    expect(() => resolveWindow(ScheduleType.FIXED, '2026-11-02', '2026-11-01')).toThrow(BadRequestException);
    expect(resolveWindow(ScheduleType.FIXED, '2026-11-02', '2026-11-02').validTo).toBe('2026-11-02');
  });

  it('variable: rango libre, no tiene que empezar en lunes (mié → mar)', () => {
    expect(resolveWindow(ScheduleType.VARIABLE, '2026-10-28', '2026-11-03')).toEqual({
      validFrom: '2026-10-28', validTo: '2026-11-03',
    });
  });

  it('variable: exige fecha de término, coherente y de periodo corto', () => {
    expect(() => resolveWindow(ScheduleType.VARIABLE, '2026-10-28', undefined)).toThrow(BadRequestException);
    expect(() => resolveWindow(ScheduleType.VARIABLE, '2026-10-28', null)).toThrow(BadRequestException);
    expect(() => resolveWindow(ScheduleType.VARIABLE, '2026-10-28', '2026-10-27')).toThrow(BadRequestException);
    // 92 días OK, 93 no
    expect(resolveWindow(ScheduleType.VARIABLE, '2026-01-01', '2026-04-02').validTo).toBe('2026-04-02');
    expect(() => resolveWindow(ScheduleType.VARIABLE, '2026-01-01', '2026-04-03')).toThrow(BadRequestException);
  });

  it('rechaza fechas inválidas o fuera de rango', () => {
    expect(() => resolveWindow(ScheduleType.FIXED, '2026-02-30', null)).toThrow(BadRequestException);
    expect(() => resolveWindow(ScheduleType.FIXED, '0206-10-26', null)).toThrow(BadRequestException);
  });
});

describe('assertDaysWithinWindow', () => {
  const win = { validFrom: '2026-10-28', validTo: '2026-10-30' }; // mié–vie

  it('fixed con término: acepta días de la semana que ocurren en el periodo', () => {
    expect(() => assertDaysWithinWindow([{ weekday: 3, date: null }, { weekday: 5, date: null }], win)).not.toThrow();
  });

  it('fixed con término: rechaza un día de la semana que no ocurre', () => {
    expect(() => assertDaysWithinWindow([{ weekday: 1, date: null }], win)).toThrow(BadRequestException);
  });

  it('variable: acepta fechas dentro del periodo y rechaza fuera de él', () => {
    expect(() => assertDaysWithinWindow([{ weekday: 3, date: '2026-10-28' }, { weekday: 5, date: '2026-10-30' }], win)).not.toThrow();
    expect(() => assertDaysWithinWindow([{ weekday: 1, date: '2026-10-26' }], win)).toThrow(BadRequestException);
    expect(() => assertDaysWithinWindow([{ weekday: 6, date: '2026-10-31' }], win)).toThrow(BadRequestException);
  });

  it('con periodo abierto no restringe', () => {
    expect(() => assertDaysWithinWindow([{ weekday: 1, date: null }, { weekday: 7, date: null }], { validFrom: '2026-10-28', validTo: null })).not.toThrow();
  });
});

describe('endsNoLaterThan', () => {
  it('trata null como infinito', () => {
    expect(endsNoLaterThan(null, null)).toBe(true);
    expect(endsNoLaterThan('2026-12-31', null)).toBe(true);
    expect(endsNoLaterThan(null, '2026-12-31')).toBe(false);
    expect(endsNoLaterThan('2026-12-31', '2026-12-31')).toBe(true);
    expect(endsNoLaterThan('2027-01-01', '2026-12-31')).toBe(false);
  });
});
