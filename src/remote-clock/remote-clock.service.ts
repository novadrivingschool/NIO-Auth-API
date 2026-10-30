import { ConflictException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { DevicesRegistry } from '../devices/devices.registry';
import { User } from '../users/entities/user.entity';
import { RemoteClockAction } from './dto/remote-clock.dto';

export const CLOCK_COMMAND_EVENT = 'clock:command';
/** Aviso a la app NIO de que sus registros cambiaron en el servidor (p. ej. cierre de un admin). */
export const RECORDS_CHANGED_EVENT = 'records:changed';
const DEFAULT_ACK_TIMEOUT_MS = 15000;
/** Espera máxima al regreso de lunch forzado por un admin (el ack llega al crear el registro; la imagen sube después). */
const FORCED_LUNCH_BACK_TIMEOUT_MS = 15000;
/** Pide a la app un screenshot para el CLOCK_OUT forzado: captura + resize + subida a S3 + vínculo al registro. */
export const SCREENSHOT_COMMAND_EVENT = 'clock:screenshot';
const FORCED_SCREENSHOT_TIMEOUT_MS = 30000;

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

    // Solo el modo NIO + AR permite que el Activity Report mande clocks a la app NIO.
    if (user.profile?.activity_linked !== true) {
      throw fail(409, 'NOT_LINKED', 'Tu usuario no está en modo NIO + AR: el Activity Report no controla la app NIO.');
    }

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

  /** Usuario activo dueño de un employee_number del NIO (o null). */
  private async userByEmployeeNumber(employeeNumber: string): Promise<User | null> {
    const emp = employeeNumber.trim();
    if (!emp) return null;
    return this.usersRepo.findOne({
      where: { isActive: true, profile: { employee_number: emp } },
      relations: ['profile'],
    });
  }

  /**
   * Force clock out de un admin con el empleado en lunch: si su app responde, registra el regreso
   * CON screenshot. Nunca lanza: sin socket / sin ack / rechazo = ok:false y el cierre sigue sin imagen.
   */
  async requestForcedLunchBack(employeeNumber: string): Promise<{ ok: boolean; recordId: number | null }> {
    const user = await this.userByEmployeeNumber(employeeNumber);
    const presence = user ? this.registry.getByUser(user.id) : null;
    if (!user || !presence) return { ok: false, recordId: null };

    const commandId = randomUUID();
    const { delivered, response } = await this.registry.requestAck<ClockCommandAck>(
      presence.deviceId,
      CLOCK_COMMAND_EVENT,
      {
        commandId,
        action: 'LUNCH_OUT',
        source: 'ADMIN_FORCE',
        requestedAt: new Date().toISOString(),
      },
      FORCED_LUNCH_BACK_TIMEOUT_MS,
    );
    if (!delivered || !response?.ok) {
      this.log.warn(`lunch-back forzado sin éxito: emp=${employeeNumber} cmd=${commandId} code=${response?.code ?? 'NO_ACK'}`);
      return { ok: false, recordId: null };
    }
    return { ok: true, recordId: typeof response.recordId === 'number' ? response.recordId : null };
  }

  /**
   * Force clock out de un admin: si la app del empleado responde, toma un screenshot y lo adjunta al
   * registro CLOCK_OUT. Nunca lanza: sin socket / sin ack / rechazo = ok:false (el clock out queda sin imagen).
   */
  async requestForcedScreenshot(employeeNumber: string, recordId: number): Promise<{ ok: boolean }> {
    const user = await this.userByEmployeeNumber(employeeNumber);
    const presence = user ? this.registry.getByUser(user.id) : null;
    if (!user || !presence) return { ok: false };

    const { delivered, response } = await this.registry.requestAck<ClockCommandAck>(
      presence.deviceId,
      SCREENSHOT_COMMAND_EVENT,
      { recordId, source: 'ADMIN_FORCE', requestedAt: new Date().toISOString() },
      FORCED_SCREENSHOT_TIMEOUT_MS,
    );
    if (!delivered || !response?.ok) {
      this.log.warn(`screenshot forzado sin éxito: emp=${employeeNumber} record=${recordId} code=${response?.code ?? 'NO_ACK'}`);
      return { ok: false };
    }
    return { ok: true };
  }

  /** Avisa a la app del empleado (si está conectada) que recargue sus registros. */
  async notifyRecordsChanged(employeeNumber: string): Promise<{ notified: number }> {
    const user = await this.userByEmployeeNumber(employeeNumber);
    if (!user) return { notified: 0 };
    return { notified: this.registry.notifyUser(user.id, RECORDS_CHANGED_EVENT, { at: new Date().toISOString() }) };
  }
}
