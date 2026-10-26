import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DevicesRegistry } from '../devices/devices.registry';

/**
 * Handshake "misma máquina": prueba que la pestaña del Activity Report y la app Electron del
 * MISMO usuario están en el mismo equipo, y que el socket de esa app sigue activo.
 *
 *  1. La web pide un nonce (issue) — queda ligado a su usuario, caduca en 30 s.
 *  2. La web se lo entrega a la app por 127.0.0.1; la app lo canjea (redeem) con SU token: el
 *     backend anota qué usuario y qué sesión (sid) lo canjearon.
 *  3. Se evalúa (evaluate) — el nonce es de un solo uso (se consume aunque falle):
 *       HANDSHAKE_INVALID      nonce desconocido, caducado, ya usado o de otro usuario
 *       DESKTOP_APP_NOT_LOCAL  nadie lo canjeó: no hay app NIO corriendo en este equipo
 *       DESKTOP_APP_OTHER_USER la app de este equipo pertenece a otro usuario
 *       DESKTOP_APP_REQUIRED   la app lo canjeó, pero su socket no está conectado
 *
 * Memoria del proceso, igual que DevicesRegistry (la presencia también lo es).
 */
export type HandshakeFailure =
  | 'HANDSHAKE_INVALID'
  | 'DESKTOP_APP_NOT_LOCAL'
  | 'DESKTOP_APP_OTHER_USER'
  | 'DESKTOP_APP_REQUIRED';

export const HANDSHAKE_MESSAGES: Record<HandshakeFailure, string> = {
  HANDSHAKE_INVALID: 'No se pudo verificar tu app NIO. Intenta de nuevo.',
  DESKTOP_APP_NOT_LOCAL: 'No detectamos la app NIO abierta en este equipo. Ábrela en esta computadora.',
  DESKTOP_APP_OTHER_USER: 'La app NIO abierta en este equipo pertenece a otro usuario.',
  DESKTOP_APP_REQUIRED: 'La app NIO de este equipo está desconectada. Espera unos segundos o reiníciala.',
};

interface Entry {
  userId: string;
  expiresAt: number;
  redeemedUserId: string | null;
  redeemedSid: string | null;
}

export const HANDSHAKE_TTL_MS = 30_000;
const MAX_ENTRIES = 5000;
/** Nonces vigentes por usuario: un usuario no puede llenar la memoria ni desplazar a otros. */
const MAX_PER_USER = 10;

@Injectable()
export class LocalHandshakeService {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly registry: DevicesRegistry) {}

  issue(userId: string, now = Date.now()): { nonce: string; expires_at: string } {
    this.sweep(now);
    this.dropOldest(userId);
    const nonce = randomBytes(24).toString('base64url');
    this.entries.set(nonce, { userId, expiresAt: now + HANDSHAKE_TTL_MS, redeemedUserId: null, redeemedSid: null });
    return { nonce, expires_at: new Date(now + HANDSHAKE_TTL_MS).toISOString() };
  }

  /** La app (token con sid) canjea el nonce. false si no existe, caducó o ya fue canjeado. */
  redeem(userId: string, sid: string, nonce: string, now = Date.now()): boolean {
    const e = this.entries.get(nonce);
    if (!e || e.expiresAt < now || e.redeemedUserId) return false;
    e.redeemedUserId = userId;
    e.redeemedSid = sid;
    return true;
  }

  /** null = las 3 validaciones se cumplen. Consume el nonce siempre. */
  evaluate(webUserId: string, nonce: string, now = Date.now()): HandshakeFailure | null {
    const e = this.entries.get(nonce);
    this.entries.delete(nonce);
    if (!e || e.expiresAt < now || e.userId !== webUserId) return 'HANDSHAKE_INVALID';
    if (!e.redeemedUserId) return 'DESKTOP_APP_NOT_LOCAL';
    if (e.redeemedUserId !== webUserId) return 'DESKTOP_APP_OTHER_USER';
    const live = this.registry.listByUser(webUserId).some((p) => p.sid === e.redeemedSid);
    return live ? null : 'DESKTOP_APP_REQUIRED';
  }

  private sweep(now: number) {
    if (this.entries.size < MAX_ENTRIES / 2) return;
    for (const [k, v] of this.entries) if (v.expiresAt < now) this.entries.delete(k);
  }

  /** Conserva solo los MAX_PER_USER - 1 más recientes del usuario (Map conserva el orden de alta). */
  private dropOldest(userId: string) {
    const mine = [...this.entries].filter(([, v]) => v.userId === userId);
    for (const [k] of mine.slice(0, Math.max(0, mine.length - (MAX_PER_USER - 1)))) this.entries.delete(k);
  }
}
