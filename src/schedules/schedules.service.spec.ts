import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { EmployeeScheduleDay } from './entities/employee-schedule-day.entity';
import { EmployeeScheduleRevision } from './entities/employee-schedule-revision.entity';
import { EmployeeSchedule, ScheduleType } from './entities/employee-schedule.entity';
import { SchedulesService } from './schedules.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';

const day = (weekday: number, extra = {}) => ({
  weekday, startTime: '09:00', endTime: '18:00', lunchStart: '14:00', lunchEnd: '15:00', ...extra,
});
/** Bloque de un horario variable: una fecha concreta. */
const dated = (date: string, extra = {}) => ({
  date, startTime: '09:00', endTime: '18:00', lunchStart: '14:00', lunchEnd: '15:00', ...extra,
});

function makeSchedule(overrides: Partial<EmployeeSchedule> = {}): EmployeeSchedule {
  return {
    id: 's1', userId: USER_ID, type: ScheduleType.FIXED, validFrom: '2020-01-06',
    validTo: null, notes: null, createdBy: null, updatedBy: null,
    createdAt: new Date(), updatedAt: new Date(),
    days: [day(1), day(2)].map((d) => ({ ...d }) as unknown as EmployeeScheduleDay),
    ...overrides,
  } as EmployeeSchedule;
}

describe('SchedulesService', () => {
  let service: SchedulesService;
  let manager: any;
  let overlaps: EmployeeSchedule[];
  let stored: EmployeeSchedule | null;
  let readRepo: any;

  beforeEach(async () => {
    overlaps = [];
    stored = null;

    const overlapQb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockImplementation(async () => overlaps),
    };

    manager = {
      findOne: jest.fn().mockImplementation(async (entity: any) => {
        if (entity === User) return { id: USER_ID };
        if (entity === EmployeeSchedule) return stored;
        return null;
      }),
      createQueryBuilder: jest.fn().mockReturnValue(overlapQb),
      create: jest.fn().mockImplementation((_e: any, data: any) => ({ ...data })),
      save: jest.fn().mockImplementation(async (e: any) => {
        if (e.days && !e.id) e.id = 'new-schedule';
        return e;
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
    };

    const getOneQb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(async () => stored ?? makeSchedule({ id: 'new-schedule' })),
    };
    readRepo = { createQueryBuilder: jest.fn().mockReturnValue(getOneQb) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulesService,
        { provide: getRepositoryToken(EmployeeSchedule), useValue: readRepo },
        { provide: getRepositoryToken(EmployeeScheduleRevision), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(User), useValue: { exists: jest.fn().mockResolvedValue(true), find: jest.fn().mockResolvedValue([]) } },
        { provide: DataSource, useValue: { transaction: (cb: any) => cb(manager) } },
      ],
    }).compile();

    service = moduleRef.get(SchedulesService);
  });

  const revisionActions = () =>
    manager.create.mock.calls
      .filter((c: any[]) => c[0] === EmployeeScheduleRevision)
      .map((c: any[]) => c[1].action);

  describe('create', () => {
    it('crea un horario fijo, bloquea al usuario y registra la revisión "created"', async () => {
      await service.create(USER_ID, {
        type: ScheduleType.FIXED, validFrom: '2026-11-02', days: [day(3), day(1)],
      } as any, ACTOR);

      const created = manager.create.mock.calls.find((c: any[]) => c[0] === EmployeeSchedule)[1];
      expect(created).toMatchObject({ userId: USER_ID, validFrom: '2026-11-02', validTo: null, createdBy: ACTOR });
      expect(created.days.map((d: any) => d.weekday)).toEqual([1, 3]);
      expect(manager.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
      expect(revisionActions()).toEqual(['created']);
    });

    it('variable: dos semanas con horario distinto por fecha, sin fines de semana', async () => {
      await service.create(USER_ID, {
        type: ScheduleType.VARIABLE, validFrom: '2026-10-26', validTo: '2026-11-08',
        days: [
          dated('2026-11-02', { startTime: '12:00', lunchStart: null, lunchEnd: null }),
          dated('2026-10-26'), dated('2026-10-27'),
          dated('2026-11-03', { endTime: '16:00' }),
        ], // sin sáb ni dom; semana 1 con lunch y semana 2 distinta
      } as any, ACTOR);
      const created = manager.create.mock.calls.find((c: any[]) => c[0] === EmployeeSchedule)[1];
      expect(created).toMatchObject({ validFrom: '2026-10-26', validTo: '2026-11-08' });
      expect(created.days.map((d: any) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-11-02', '2026-11-03']);
      expect(created.days.map((d: any) => d.weekday)).toEqual([1, 2, 1, 2]);
      expect(created.days[2]).toMatchObject({ startTime: '12:00', lunchStart: null });
    });

    it('variable: BadRequest sin fecha de término', async () => {
      await expect(service.create(USER_ID, {
        type: ScheduleType.VARIABLE, validFrom: '2026-10-28', days: [dated('2026-10-28')],
      } as any, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('BadRequest si una fecha cae fuera del periodo', async () => {
      await expect(service.create(USER_ID, {
        type: ScheduleType.VARIABLE, validFrom: '2026-10-28', validTo: '2026-10-30', days: [dated('2026-11-02')],
      } as any, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('409 si la vigencia se traslapa y no se pidió cerrar el anterior', async () => {
      overlaps = [makeSchedule()];
      const promise = service.create(USER_ID, {
        type: ScheduleType.FIXED, validFrom: '2026-11-02', days: [day(1)],
      } as any, ACTOR);
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('closePrevious cierra el fijo vigente el día anterior y registra "closed" + "created"', async () => {
      overlaps = [makeSchedule({ id: 'prev', validFrom: '2026-01-05', validTo: null })];
      await service.create(USER_ID, {
        type: ScheduleType.FIXED, validFrom: '2026-11-02', days: [day(1)], closePrevious: true,
      } as any, ACTOR);

      expect(manager.update).toHaveBeenCalledWith(
        EmployeeSchedule, { id: 'prev' }, { validTo: '2026-11-01', updatedBy: ACTOR },
      );
      expect(revisionActions()).toEqual(['closed', 'created']);
    });

    it('closePrevious NO aplica a un horario variable (no trunca el patrón recurrente)', async () => {
      overlaps = [makeSchedule({ validFrom: '2026-01-05', validTo: null })];
      await expect(service.create(USER_ID, {
        type: ScheduleType.VARIABLE, validFrom: '2026-10-26', validTo: '2026-11-01', days: [dated('2026-10-26')], closePrevious: true,
      } as any, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it('closePrevious NO aplica si cerrarlo dejaría sin cobertura un tramo posterior', async () => {
      overlaps = [makeSchedule({ validFrom: '2026-01-05', validTo: null })];
      await expect(service.create(USER_ID, {
        type: ScheduleType.FIXED, validFrom: '2026-11-02', validTo: '2026-11-30', days: [day(1)], closePrevious: true,
      } as any, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it('closePrevious NO aplica con más de un traslape', async () => {
      overlaps = [makeSchedule({ id: 'a', validTo: '2026-11-05' }), makeSchedule({ id: 'b', validFrom: '2026-11-06' })];
      await expect(service.create(USER_ID, {
        type: ScheduleType.FIXED, validFrom: '2026-11-02', days: [day(1)], closePrevious: true,
      } as any, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 si el usuario no existe', async () => {
      manager.findOne.mockImplementation(async () => null);
      await expect(service.create(USER_ID, {
        type: ScheduleType.FIXED, validFrom: '2026-11-02', days: [day(1)],
      } as any, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('sin cambios reales no escribe ni registra revisión', async () => {
      stored = makeSchedule();
      await service.update(USER_ID, 's1', { days: [day(1), day(2)] } as any, ACTOR);
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('cambiar días reemplaza los bloques y registra "updated"', async () => {
      stored = makeSchedule();
      await service.update(USER_ID, 's1', { days: [day(1, { endTime: '17:00' })] } as any, ACTOR);
      expect(manager.delete).toHaveBeenCalledWith(EmployeeScheduleDay, { scheduleId: 's1' });
      expect(manager.insert).toHaveBeenCalled();
      expect(revisionActions()).toEqual(['updated']);
    });

    it('poner fecha de término anterior se registra como "closed"', async () => {
      stored = makeSchedule();
      await service.update(USER_ID, 's1', { validTo: '2026-12-31' } as any, ACTOR);
      expect(manager.update).toHaveBeenCalledWith(
        EmployeeSchedule, { id: 's1' }, expect.objectContaining({ validTo: '2026-12-31' }),
      );
      expect(revisionActions()).toEqual(['closed']);
    });

    it('409 si el cambio de vigencia se traslapa con otro horario', async () => {
      stored = makeSchedule();
      overlaps = [makeSchedule({ id: 'other', validFrom: '2026-12-01' })];
      await expect(service.update(USER_ID, 's1', { validTo: '2026-12-31' } as any, ACTOR))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('404 si el horario no es del usuario', async () => {
      stored = null;
      await expect(service.update(USER_ID, 'nope', { notes: 'x' } as any, ACTOR))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('borra también un horario ya iniciado y deja el snapshot en la revisión "deleted"', async () => {
      stored = makeSchedule({ validFrom: '2020-01-06' });
      await service.remove(USER_ID, 's1', ACTOR);
      expect(manager.delete).toHaveBeenCalledWith(EmployeeSchedule, { id: 's1' });
      expect(revisionActions()).toEqual(['deleted']);
    });

    it('404 si el horario no es de ese usuario', async () => {
      stored = null;
      await expect(service.remove(USER_ID, 'nope', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('borra un horario futuro y deja la revisión "deleted"', async () => {
      stored = makeSchedule({ validFrom: '2099-01-05' });
      await service.remove(USER_ID, 's1', ACTOR);
      expect(manager.delete).toHaveBeenCalledWith(EmployeeSchedule, { id: 's1' });
      expect(revisionActions()).toEqual(['deleted']);
    });
  });
});
