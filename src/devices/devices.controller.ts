// src/devices/devices.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  NotFoundException,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DevicesRegistry } from './devices.registry'; // solo para /hello
import { User } from 'src/users/entities/user.entity';
import { AuthSession } from 'src/users/entities/auth-session.entity';

const TAG = '[http/devices]';
const L = (...a: any[]) => console.log(TAG, ...a);
const W = (...a: any[]) => console.warn(TAG, ...a);

type DeviceRow = {
  deviceId: string;
  client: 'electron' | 'web' | 'mobile' | string;
  label?: string | null;
  lastUsedAt?: string | null;
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
  ) {}

  /**
   * DEVUELVE TODOS LOS REGISTROS DE auth_sessions, sin filtros ni parámetros.
   * Respuesta: { user: null, devices: DeviceRow[] }
   */
  @Get('online')
  async online() {
    L('📥 GET /devices/online (ALL, no filters)');

    // Trae TODO de la tabla, con user y profile, ordenado por updatedAt DESC
    const sessions = await this.sessionsRepo.find({
      relations: ['user', 'user.profile'],
      order: { updatedAt: 'DESC' },
    });

    L('💾 auth_sessions (ALL) count:', sessions.length);

    const devices: DeviceRow[] = sessions.map(s => ({
      deviceId: s.deviceId,
      client: s.client,
      label: s.label ?? null,
      lastUsedAt: s.lastUsedAt ? toIso(s.lastUsedAt) ?? null : null,
      createdAt: toIso(s.createdAt),
      updatedAt: toIso(s.updatedAt),
      user: s.user ?? null,
    }));

    L('✅ RESP (ALL devices):', devices.length);
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
