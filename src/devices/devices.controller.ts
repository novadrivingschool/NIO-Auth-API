// src/devices/devices.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Query,
  NotFoundException,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { DevicesRegistry } from './devices.registry'; // solo para /hello
import { User } from 'src/users/entities/user.entity';
import { AuthSession } from 'src/users/entities/auth-session.entity';
import { HandshakeCapture } from 'src/handshakes/entities/handshake-capture.entity';

const TAG = '[http/devices]';
const L = (...a: any[]) => console.log(TAG, ...a);
const W = (...a: any[]) => console.warn(TAG, ...a);

type DeviceRow = {
  userId: string;
  /** null si el usuario nunca registró un dispositivo con sesión vigente */
  deviceId: string | null;
  client: 'electron' | 'web' | 'mobile' | string | null;
  label?: string | null;
  lastUsedAt?: string | null;
  /** true solo si hay un socket conectado ahora (presencia real) */
  online: boolean;
  /** true si hay socket conectado (canal de control), aunque no tenga turno abierto */
  connected: boolean;
  /** true si está en lunch (turno abierto, app sin medir actividad ni tomar capturas) */
  onLunch: boolean;
  /** cantidad de handshakes históricos (para mostrar el acordeón de historial) */
  handshakeCount: number;
  /** momento en que se abrió el socket (≈ clock-in), solo si online */
  connectedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  user?: User | null;
};

// number/Date/string → ISO
function toIso(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof v === 'string') return v;
  return undefined;
}

@Controller('devices')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class DevicesController {
  constructor(
    private readonly registry: DevicesRegistry, // usado por /hello
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(AuthSession) private readonly sessionsRepo: Repository<AuthSession>,
    @InjectRepository(HandshakeCapture) private readonly handshakesRepo: Repository<HandshakeCapture>,
  ) {}

  /**
   * Estado del personal con presencia REAL (socket conectado ahora).
   * El socket se abre en clock-in y se cierra en clock-out, así que
   * `online` equivale a "tiene turno activo y conexión".
   *
   * Se parte de USUARIOS (no de sesiones): cada usuario activo (todos los roles)
   * aparece una vez, Active u Offline,
   * aunque nunca haya abierto la app (deviceId = null).
   *
   * - `all=true` + rol admin/super_admin: todos los usuarios activos.
   * - En cualquier otro caso: solo el usuario del token.
   * Respuesta: { user: null, devices: DeviceRow[] } (online primero).
   */
  @Get('online')
  async online(@Req() req: Request, @Query('all') all?: string) {
    const me = req.user as { userId?: string; roles?: string[] } | undefined;
    const isAdmin = (me?.roles ?? []).some(r =>
      ['admin', 'super_admin'].includes(String(r).toLowerCase()),
    );
    const wantsAll = all === 'true' || all === '1';
    const scopeAll = wantsAll && isAdmin;

    if (wantsAll && !isAdmin) {
      W('all=true solicitado sin rol admin → se limita al propio usuario', { userId: me?.userId });
    }
    if (!scopeAll && !me?.userId) {
      throw new NotFoundException('Usuario no identificado');
    }

    L('📥 GET /devices/online', { scopeAll, wantsAll, isAdmin, roles: me?.roles, userId: me?.userId });

    const users = scopeAll
      ? await this.usersRepo.find({ where: { isActive: true }, relations: ['profile'] })
      : await this.usersRepo.find({ where: { id: me!.userId }, relations: ['profile'] });

    const userIds = new Set(users.map(u => u.id));

    // Sesiones vigentes (una revocada/inactiva no puede estar online), la más reciente primero.
    const sessions = (
      await this.sessionsRepo.find({
        where: { isActive: true, revokedAt: IsNull() },
        order: { updatedAt: 'DESC' },
      })
    ).filter(s => userIds.has(s.userId));

    // Presencia en memoria (sockets conectados ahora), una por usuario.
    const presenceByUser = new Map<string, ReturnType<DevicesRegistry['listByUser']>[number]>();
    for (const p of this.registry.listByUser()) {
      if (userIds.has(p.userId) && !presenceByUser.has(p.userId)) presenceByUser.set(p.userId, p);
    }

    // Conteo de handshakes por usuario. Si la tabla aún no existe (migración
    // pendiente) NO debe tumbar el monitor: se degrada a 0.
    const handshakeCounts = new Map<string, number>();
    try {
      const raw = await this.handshakesRepo
        .createQueryBuilder('h')
        .select('h.targetUserId', 'userId')
        .addSelect('COUNT(*)', 'count')
        .where('h.targetUserId IN (:...ids)', { ids: users.length ? users.map(u => u.id) : [''] })
        .groupBy('h.targetUserId')
        .getRawMany<{ userId: string; count: string }>();
      for (const r of raw) handshakeCounts.set(r.userId, Number(r.count));
    } catch (e) {
      W('handshake counts no disponibles (¿migración pendiente?)', (e as Error)?.message);
    }

    const devices: DeviceRow[] = users.map(u => {
      const p = presenceByUser.get(u.id);
      const userSessions = sessions.filter(s => s.userId === u.id);
      // Si está online, usa la sesión de ese dispositivo; si no, la más reciente.
      const s = (p && userSessions.find(x => x.deviceId === p.deviceId)) || userSessions[0];

      return {
        userId: u.id,
        deviceId: p?.deviceId ?? s?.deviceId ?? null,
        client: s?.client ?? null,
        label: s?.label ?? null,
        lastUsedAt: s?.lastUsedAt ? toIso(s.lastUsedAt) ?? null : null,
        online: !!p && p.onShift,
        connected: !!p,
        onLunch: !!p && p.onShift && p.onLunch,
        handshakeCount: handshakeCounts.get(u.id) ?? 0,
        connectedAt: p && p.onShift ? toIso(p.connectedAt) ?? null : null,
        createdAt: toIso(s?.createdAt),
        updatedAt: toIso(s?.updatedAt),
        user: u,
      };
    });

    // Online primero; luego por nombre para un orden estable.
    const nameOf = (r: DeviceRow) =>
      `${r.user?.profile?.firstName ?? ''} ${r.user?.profile?.lastName ?? ''}`.trim().toLowerCase();
    devices.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return nameOf(a).localeCompare(nameOf(b));
    });

    L('✅ RESP staff:', devices.length, 'online:', devices.filter(d => d.online).length);
    return { user: null, devices };
  }

  @Post('hello')
  hello(
    @Body() body: { deviceId: string; message?: string },
    @Req() req: Request,
  ) {
    if (!body?.deviceId) throw new NotFoundException('deviceId requerido');

    const fromUser =
      (req.user as any)?.id ||
      (req.user as any)?.sub ||
      (req.user as any)?.userId;

    const payload = {
      message: body.message ?? 'Hello!',
      at: new Date().toISOString(),
      fromUser,
    };

    L('POST /devices/hello IN', { deviceId: body.deviceId, payload });

    const ok = this.registry.emitToDevice(body.deviceId, 'hello', payload);
    if (!ok) {
      W('emitToDevice -> false (device offline?)', { deviceId: body.deviceId });
      throw new NotFoundException('Device no está online');
    }

    L('POST /devices/hello OK', { deviceId: body.deviceId });
    return { ok: true, sentTo: body.deviceId };
  }
}
