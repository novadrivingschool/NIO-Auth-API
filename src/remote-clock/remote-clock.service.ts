import { ConflictException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { DevicesRegistry } from '../devices/devices.registry';
import { User } from '../users/entities/user.entity';
import { RemoteClockAction } from './dto/remote-clock.dto';

export const CLOCK_COMMAND_EVENT = 'clock:command';
const DEFAULT_ACK_TIMEOUT_MS = 15000;

/** Respuesta (ack) que devuelve la app Electron. */
export interface ClockCommandAck {
  ok: boolean;
  code?: string;
  message?: string;
  recordId?: number;
  /** true si ya estaba en el estado pedido (no se creó registro). */
  alreadyInState?: boolean;
}

export interface RemoteClockResult {
  ok: true;
  commandId: string;
  action: RemoteClockAction;
  recordId: number | null;
  alreadyInState: boolean;
}

const fail = (status: number, code: string, message: string) =>
  new HttpException({ statusCode: status, code, message }, status);

@Injectable()
export class RemoteClockService {
  private readonly log = new Logger(RemoteClockService.name);
  /** Un comando a la vez por usuario (evita doble clic / comandos cruzados). */
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly registry: DevicesRegistry,
    private readonly config: ConfigService,
  ) {}

  private get ackTimeoutMs(): number {
    const n = Number(this.config.get('REMOTE_CLOCK_ACK_TIMEOUT_MS'));
    return Number.isFinite(n) && n >= 2000 && n <= 60000 ? n : DEFAULT_ACK_TIMEOUT_MS;
  }

  /** Estado del canal de control del propio usuario (para pintar la vista). */
  status(userId: string) {
    const p = this.registry.getByUser(userId);
    return {
      connected: !!p,
      onShift: !!p && p.onShift,
      connectedAt: p ? new Date(p.connectedAt).toISOString() : null,
    };
  }

  async request(userId: string, externalEmployeeNumber: string, action: RemoteClockAction): Promise<RemoteClockResult> {
    const user = await this.usersRepo.findOne({ where: { id: userId, isActive: true }, relations: ['profile'] });
    if (!user) throw new ForbiddenException('Usuario no encontrado o inactivo.');

    const mine = user.profile?.external_employee_number?.trim().toUpperCase();
    if (!mine) {
      throw fail(403, 'NO_EXTERNAL_NUMBER', 'Tu usuario no tiene número de empleado externo asignado.');
    }
    if (mine !== externalEmployeeNumber.trim().toUpperCase()) {
      throw fail(403, 'EXTERNAL_MISMATCH', 'El número de empleado externo no corresponde a tu usuario.');
    }

    if (this.inFlight.has(userId)) {
      throw fail(409, 'COMMAND_IN_PROGRESS', 'Ya hay un clock en proceso. Espera unos segundos.');
    }
    this.inFlight.add(userId);
    try {
      const presence = this.registry.getByUser(userId);
      if (!presence) {
        throw fail(409, 'DEVICE_UNAVAILABLE', 'Tu app de escritorio no está conectada.');
      }

      const commandId = randomUUID();
      const { delivered, response } = await this.registry.requestAck<ClockCommandAck>(
        presence.deviceId,
        CLOCK_COMMAND_EVENT,
        {
          commandId,
          action,
          source: 'ACTIVITY_REPORT',
          requestedBy: userId,
          requestedAt: new Date().toISOString(),
        },
        this.ackTimeoutMs,
      );

      if (!delivered || !response) {
        this.log.warn(`sin ack: user=${userId} action=${action} cmd=${commandId}`);
        throw fail(409, 'DEVICE_UNAVAILABLE', 'Tu app de escritorio no respondió.');
      }
      if (!response.ok) {
        throw fail(409, String(response.code ?? 'DEVICE_REJECTED').slice(0, 40), String(response.message ?? 'La app rechazó el comando.').slice(0, 200));
      }

      this.log.log(`ok: user=${userId} action=${action} cmd=${commandId} record=${response.recordId ?? '-'}`);
      return {
        ok: true,
        commandId,
        action,
        recordId: typeof response.recordId === 'number' ? response.recordId : null,
        alreadyInState: response.alreadyInState === true,
      };
    } finally {
      this.inFlight.delete(userId);
    }
  }
}
