import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  CreateScheduleDto,
  ListSchedulesQueryDto,
  UpdateScheduleDto,
} from './dto/schedule.dto';
import { EmployeeScheduleDay } from './entities/employee-schedule-day.entity';
import {
  EmployeeSchedule,
  ScheduleType,
} from './entities/employee-schedule.entity';
import {
  EmployeeScheduleRevision,
  ScheduleRevisionAction,
} from './entities/employee-schedule-revision.entity';
import { addDays } from './schedule-dates.util';
import {
  assertDaysWithinWindow,
  compareDays,
  endsNoLaterThan,
  normalizeDays,
  NormalizedDay,
  resolveWindow,
} from './schedule-rules';

const DEFAULT_HISTORY_LIMIT = 100;

export interface ScheduleRevisionView {
  id: string;
  scheduleId: string;
  action: ScheduleRevisionAction;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: Date;
}

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    @InjectRepository(EmployeeSchedule)
    private readonly schedules: Repository<EmployeeSchedule>,
    @InjectRepository(EmployeeScheduleRevision)
    private readonly revisions: Repository<EmployeeScheduleRevision>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  // ───────────────────────────── Lecturas ─────────────────────────────

  async list(
    userId: string,
    query: ListSchedulesQueryDto = {},
  ): Promise<EmployeeSchedule[]> {
    await this.assertUserExists(userId);

    const qb = this.schedules
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.days', 'd')
      .where('s.userId = :userId', { userId });

    if (query.type) qb.andWhere('s.type = :type', { type: query.type });
    // Devuelve los horarios cuya vigencia toca el rango pedido.
    if (query.from) {
      qb.andWhere('(s.validTo IS NULL OR s.validTo >= :from)', {
        from: query.from,
      });
    }
    if (query.to) qb.andWhere('s.validFrom <= :to', { to: query.to });

    return qb
      .orderBy('s.validFrom', 'DESC')
      .addOrderBy('d.date', 'ASC')
      .addOrderBy('d.weekday', 'ASC')
      .getMany();
  }

  async history(
    userId: string,
    options: { limit?: number; scheduleId?: string } = {},
  ): Promise<ScheduleRevisionView[]> {
    await this.assertUserExists(userId);

    const rows = await this.revisions.find({
      where: {
        userId,
        ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
      },
      order: { changedAt: 'DESC' },
      take: options.limit ?? DEFAULT_HISTORY_LIMIT,
    });

    const actorIds = [
      ...new Set(rows.map((r) => r.changedBy).filter((id): id is string => !!id)),
    ];
    const actors = actorIds.length
      ? await this.users.find({
          where: { id: In(actorIds) },
          relations: { profile: true },
        })
      : [];
    const nameById = new Map(
      actors.map((u) => [
        u.id,
        [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ') ||
          u.email ||
          null,
      ]),
    );

    return rows.map((r) => ({
      id: r.id,
      scheduleId: r.scheduleId,
      action: r.action,
      snapshot: r.snapshot,
      changedBy: r.changedBy,
      changedByName: r.changedBy ? (nameById.get(r.changedBy) ?? null) : null,
      changedAt: r.changedAt,
    }));
  }

  // ───────────────────────────── Escrituras ─────────────────────────────

  async create(
    userId: string,
    dto: CreateScheduleDto,
    actorId: string | null,
  ): Promise<EmployeeSchedule> {
    const window = resolveWindow(dto.type, dto.validFrom, dto.validTo);
    const days = normalizeDays(dto.days, dto.type);
    assertDaysWithinWindow(days, window);

    const createdId = await this.dataSource.transaction(async (m) => {
      await this.lockUser(m, userId);

      const overlaps = await this.findOverlapping(
        m,
        userId,
        window.validFrom,
        window.validTo,
      );

      let previousToClose: EmployeeSchedule | null = null;
      if (overlaps.length > 0) {
        previousToClose = this.pickClosablePrevious(dto, window, overlaps);
        if (!previousToClose) throw this.conflict(overlaps);
      }

      if (previousToClose) {
        previousToClose.validTo = addDays(window.validFrom, -1);
        previousToClose.updatedBy = actorId;
        await m.update(
          EmployeeSchedule,
          { id: previousToClose.id },
          { validTo: previousToClose.validTo, updatedBy: actorId },
        );
        await this.recordRevision(m, previousToClose, 'closed', actorId);
      }

      const schedule = m.create(EmployeeSchedule, {
        userId,
        type: dto.type,
        validFrom: window.validFrom,
        validTo: window.validTo,
        notes: dto.notes?.trim() || null,
        createdBy: actorId,
        updatedBy: actorId,
        days: days.map((d) => m.create(EmployeeScheduleDay, d)),
      });
      await m.save(schedule);
      await this.recordRevision(m, schedule, 'created', actorId);
      return schedule.id;
    });

    return this.getOne(userId, createdId);
  }

  async update(
    userId: string,
    scheduleId: string,
    dto: UpdateScheduleDto,
    actorId: string | null,
  ): Promise<EmployeeSchedule> {
    await this.dataSource.transaction(async (m) => {
      await this.lockUser(m, userId);
      const current = await this.loadSchedule(m, userId, scheduleId);

      const validFrom = dto.validFrom ?? current.validFrom;
      // `undefined` = sin cambio; `null` = sin término (solo válido en fixed).
      const requestedTo =
        dto.validTo === undefined ? current.validTo : dto.validTo;
      const window = resolveWindow(current.type, validFrom, requestedTo);

      const nextDays = dto.days ? normalizeDays(dto.days, current.type) : null;
      // Aunque no cambien los días, un periodo más corto puede dejarlos fuera.
      assertDaysWithinWindow(nextDays ?? this.plainDays(current), window);
      const nextNotes =
        dto.notes === undefined ? current.notes : dto.notes?.trim() || null;

      const windowChanged =
        window.validFrom !== current.validFrom ||
        window.validTo !== current.validTo;
      const daysChanged =
        nextDays !== null &&
        JSON.stringify(nextDays) !== JSON.stringify(this.plainDays(current));
      const notesChanged = nextNotes !== current.notes;

      if (!windowChanged && !daysChanged && !notesChanged) return;

      if (windowChanged) {
        const overlaps = await this.findOverlapping(
          m,
          userId,
          window.validFrom,
          window.validTo,
          current.id,
        );
        if (overlaps.length > 0) throw this.conflict(overlaps);
      }

      await m.update(
        EmployeeSchedule,
        { id: current.id },
        {
          validFrom: window.validFrom,
          validTo: window.validTo,
          notes: nextNotes,
          updatedBy: actorId,
        },
      );

      if (daysChanged && nextDays) {
        await m.delete(EmployeeScheduleDay, { scheduleId: current.id });
        await m.insert(
          EmployeeScheduleDay,
          nextDays.map((d) => ({ ...d, scheduleId: current.id })),
        );
      }

      const after = await this.loadSchedule(m, userId, scheduleId);
      const onlyShortened =
        windowChanged &&
        !daysChanged &&
        !notesChanged &&
        window.validFrom === current.validFrom &&
        window.validTo !== null &&
        (current.validTo === null || window.validTo < current.validTo);

      await this.recordRevision(
        m,
        after,
        onlyShortened ? 'closed' : 'updated',
        actorId,
      );
    });

    return this.getOne(userId, scheduleId);
  }

  /**
   * Borra un horario (también uno ya iniciado). El rastro no se pierde: la
   * revisión 'deleted' conserva el snapshot completo y no depende del horario.
   * Para solo terminar un horario hacia adelante basta ponerle `validTo`.
   */
  async remove(
    userId: string,
    scheduleId: string,
    actorId: string | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      await this.lockUser(m, userId);
      const current = await this.loadSchedule(m, userId, scheduleId);

      await this.recordRevision(m, current, 'deleted', actorId);
      await m.delete(EmployeeSchedule, { id: current.id });
    });
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  async getOne(userId: string, scheduleId: string): Promise<EmployeeSchedule> {
    const schedule = await this.schedules
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.days', 'd')
      .where('s.id = :scheduleId AND s.userId = :userId', { scheduleId, userId })
      .orderBy('d.date', 'ASC')
      .addOrderBy('d.weekday', 'ASC')
      .getOne();
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  private async assertUserExists(userId: string): Promise<void> {
    if (!(await this.users.exists({ where: { id: userId } }))) {
      throw new NotFoundException('User not found');
    }
  }

  /**
   * Serializa las escrituras de horarios de un mismo usuario: dos altas
   * simultáneas no pueden pasar ambas la validación de traslape.
   */
  private async lockUser(m: EntityManager, userId: string): Promise<void> {
    const user = await m.findOne(User, {
      where: { id: userId },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('User not found');
  }

  private async loadSchedule(
    m: EntityManager,
    userId: string,
    scheduleId: string,
  ): Promise<EmployeeSchedule> {
    const schedule = await m.findOne(EmployeeSchedule, {
      where: { id: scheduleId, userId },
      relations: { days: true },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    schedule.days.sort(compareDays);
    return schedule;
  }

  /** Horarios del usuario cuya vigencia toca [from, to] (to = null → sin fin). */
  private findOverlapping(
    m: EntityManager,
    userId: string,
    from: string,
    to: string | null,
    excludeId?: string,
  ): Promise<EmployeeSchedule[]> {
    const qb = m
      .createQueryBuilder(EmployeeSchedule, 's')
      .leftJoinAndSelect('s.days', 'd')
      .where('s.userId = :userId', { userId })
      .andWhere('(s.validTo IS NULL OR s.validTo >= :from)', { from });
    if (to) qb.andWhere('s.validFrom <= :to', { to });
    if (excludeId) qb.andWhere('s.id <> :excludeId', { excludeId });
    return qb.orderBy('s.validFrom', 'ASC').getMany();
  }

  /**
   * `closePrevious` solo aplica a un horario fijo nuevo que reemplaza a un fijo
   * vigente que ya había iniciado, y solo si cerrarlo no deja sin cobertura un
   * tramo posterior al nuevo.
   */
  private pickClosablePrevious(
    dto: CreateScheduleDto,
    window: { validFrom: string; validTo: string | null },
    overlaps: EmployeeSchedule[],
  ): EmployeeSchedule | null {
    if (!dto.closePrevious || dto.type !== ScheduleType.FIXED) return null;
    if (overlaps.length !== 1) return null;

    const [previous] = overlaps;
    const canClose =
      previous.type === ScheduleType.FIXED &&
      previous.validFrom < window.validFrom &&
      endsNoLaterThan(previous.validTo, window.validTo);
    return canClose ? previous : null;
  }

  private conflict(overlaps: EmployeeSchedule[]): ConflictException {
    const conflicts = overlaps.map((s) => ({
      id: s.id,
      type: s.type,
      validFrom: s.validFrom,
      validTo: s.validTo,
    }));
    const first = conflicts[0];
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `Overlaps an existing ${first.type} schedule (${first.validFrom} → ${first.validTo ?? 'no end date'}). Set an end date on it first.`,
      conflicts,
    });
  }

  private plainDays(schedule: EmployeeSchedule): NormalizedDay[] {
    return [...schedule.days].sort(compareDays).map((d) => ({
        weekday: d.weekday,
        date: d.date ?? null,
        startTime: d.startTime,
        endTime: d.endTime,
        lunchStart: d.lunchStart ?? null,
        lunchEnd: d.lunchEnd ?? null,
      }));
  }

  private async recordRevision(
    m: EntityManager,
    schedule: EmployeeSchedule,
    action: ScheduleRevisionAction,
    actorId: string | null,
  ): Promise<void> {
    await m.save(
      m.create(EmployeeScheduleRevision, {
        scheduleId: schedule.id,
        userId: schedule.userId,
        action,
        changedBy: actorId,
        snapshot: {
          id: schedule.id,
          type: schedule.type,
          validFrom: schedule.validFrom,
          validTo: schedule.validTo,
          notes: schedule.notes,
          days: this.plainDays(schedule),
        },
      }),
    );
    this.logger.log(
      `schedule ${action}: schedule=${schedule.id} user=${schedule.userId} by=${actorId ?? 'system'}`,
    );
  }
}
