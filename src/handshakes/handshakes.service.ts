import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { DevicesRegistry } from '../devices/devices.registry';
import { HandshakeCapture, HandshakeStatus } from './entities/handshake-capture.entity';
import { HandshakeFailDto, HandshakeResultDto } from './dto/handshake-result.dto';

/** Tiempo máximo que se espera la respuesta del dispositivo. */
export const HANDSHAKE_TIMEOUT_MS = 20_000;
/** Evento que reciben los admins web (sala `admin:{userId}`). */
export const HANDSHAKE_UPDATE_EVENT = 'handshake:update';
/** Evento que recibe el dispositivo (Electron). */
export const HANDSHAKE_REQUEST_EVENT = 'handshake:request';

@Injectable()
export class HandshakesService implements OnModuleInit {
  private readonly log = new Logger(HandshakesService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(HandshakeCapture)
    private readonly repo: Repository<HandshakeCapture>,
    private readonly registry: DevicesRegistry,
  ) {}

  /**
   * Los temporizadores viven en memoria: si el backend se reinicia con handshakes
   * pendientes, quedarían "Waiting" para siempre. Al arrancar se cierran los vencidos
   * y se reprograma el timeout de los que aún están dentro de la ventana.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.expireStale();
      const pending = await this.repo.find({ where: { status: 'pending' } });
      for (const row of pending) {
        const left = HANDSHAKE_TIMEOUT_MS - (Date.now() - row.requestedAt.getTime());
        this.schedule(row.id, Math.max(left, 0));
      }
    } catch (e) {
      // Tabla ausente (migración pendiente) no debe impedir que el backend arranque.
      this.log.warn(`No se pudo reconciliar handshakes pendientes: ${(e as Error)?.message}`);
    }
  }

  /** Crea el handshake y se lo envía al dispositivo (sin aviso al empleado). */
  async request(adminId: string, targetUserId: string) {
    const presence = this.registry.listByUser(targetUserId)[0];
    if (!presence || !presence.onShift) {
      throw new ConflictException('El usuario no está conectado (sin clock-in).');
    }

    const row = await this.repo.save(
      this.repo.create({
        targetUserId,
        targetDeviceId: presence.deviceId,
        requestedById: adminId,
        status: 'pending',
      }),
    );

    // Una sola emisión a la sala del dispositivo (emitToDevice emitiría dos veces al mismo socket).
    const delivered = this.registry.emitToRoom(`device:${presence.deviceId}`, HANDSHAKE_REQUEST_EVENT, {
      captureId: row.id,
      requestedAt: row.requestedAt.toISOString(),
    });
    if (!delivered) {
      await this.finish(row.id, 'failed', { error: 'No se pudo entregar al dispositivo' });
      throw new ConflictException('No se pudo entregar la solicitud al dispositivo.');
    }

    this.schedule(row.id, HANDSHAKE_TIMEOUT_MS);

    this.log.log(`handshake ${row.id} → user ${targetUserId} device ${presence.deviceId}`);
    return this.toView(await this.load(row.id));
  }

  /** El dispositivo entrega captura y actividad. Solo el propio usuario objetivo. */
  async complete(id: string, userId: string, dto: HandshakeResultDto) {
    const row = await this.loadOwned(id, userId);
    return this.finish(row.id, 'completed', {
      imageKey: dto.imageKey ?? null,
      thumbKey: dto.thumbKey ?? null,
      employeeNumber: dto.employeeNumber ?? null,
      activity: (dto.activity as HandshakeCapture['activity']) ?? null,
    });
  }

  /** El dispositivo informa que no pudo capturar. */
  async fail(id: string, userId: string, dto: HandshakeFailDto) {
    const row = await this.loadOwned(id, userId);
    return this.finish(row.id, 'failed', { error: dto.error ?? 'Error en el dispositivo' });
  }

  async list(targetUserId: string) {
    await this.expireStale();
    const rows = await this.repo.find({
      where: { targetUserId },
      relations: ['requestedBy', 'requestedBy.profile', 'targetUser', 'targetUser.profile'],
      order: { requestedAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => this.toView(r));
  }

  async get(id: string) {
    await this.expireStale();
    return this.toView(await this.load(id));
  }

  // ───────────────────────────── internos ─────────────────────────────

  private async load(id: string): Promise<HandshakeCapture> {
    const row = await this.repo.findOne({
      where: { id },
      relations: ['requestedBy', 'requestedBy.profile', 'targetUser', 'targetUser.profile'],
    });
    if (!row) throw new NotFoundException('Handshake no encontrado');
    return row;
  }

  private async loadOwned(id: string, userId: string): Promise<HandshakeCapture> {
    const row = await this.load(id);
    if (row.targetUserId !== userId) {
      throw new ForbiddenException('Este handshake no corresponde a tu usuario');
    }
    // 'timeout' se acepta: la respuesta tardía es válida y mejora la auditoría.
    if (row.status !== 'pending' && row.status !== 'timeout') {
      throw new ConflictException('El handshake ya fue resuelto');
    }
    return row;
  }

  private schedule(id: string, ms: number): void {
    const prev = this.timers.get(id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => void this.markTimeout(id), ms);
    timer.unref?.();
    this.timers.set(id, timer);
  }

  /** Cierra como timeout los pendientes que ya excedieron la ventana (respaldo del temporizador). */
  private async expireStale(): Promise<void> {
    const cutoff = new Date(Date.now() - HANDSHAKE_TIMEOUT_MS - 5_000);
    await this.repo.update(
      { status: 'pending', requestedAt: LessThan(cutoff) },
      { status: 'timeout', respondedAt: new Date(), error: 'Sin respuesta del dispositivo' },
    );
  }

  private async markTimeout(id: string): Promise<void> {
    this.timers.delete(id);
    const res = await this.repo.update(
      { id, status: 'pending' },
      { status: 'timeout', respondedAt: new Date(), error: 'Sin respuesta del dispositivo' },
    );
    if (res.affected) {
      this.log.warn(`handshake ${id} → timeout`);
      await this.notify(id);
    }
  }

  private async finish(
    id: string,
    status: HandshakeStatus,
    patch: Partial<HandshakeCapture>,
  ) {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    await this.repo.update({ id }, { ...patch, status, respondedAt: new Date(), ...(status === 'completed' ? { error: null } : {}) });
    const view = await this.notify(id);
    return view;
  }

  /** Empuja el estado actual al admin que lo pidió. */
  private async notify(id: string) {
    const row = await this.load(id);
    const view = this.toView(row);
    this.registry.emitToRoom(`admin:${row.requestedById}`, HANDSHAKE_UPDATE_EVENT, view);
    return view;
  }

  private nameOf(u?: { email?: string | null; profile?: { firstName?: string; lastName?: string } | null } | null) {
    const n = `${u?.profile?.firstName ?? ''} ${u?.profile?.lastName ?? ''}`.trim();
    return n || u?.email || null;
  }

  private toView(r: HandshakeCapture) {
    return {
      id: r.id,
      status: r.status,
      targetUserId: r.targetUserId,
      targetName: this.nameOf(r.targetUser),
      targetDeviceId: r.targetDeviceId,
      requestedById: r.requestedById,
      requestedByName: this.nameOf(r.requestedBy),
      requestedAt: r.requestedAt?.toISOString?.() ?? r.requestedAt,
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
      latencyMs: r.respondedAt ? r.respondedAt.getTime() - r.requestedAt.getTime() : null,
      employeeNumber: r.employeeNumber,
      imageKey: r.imageKey,
      thumbKey: r.thumbKey,
      activity: r.activity,
      error: r.error,
    };
  }
}
