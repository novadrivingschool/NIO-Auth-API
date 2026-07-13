// src/auth/login-throttle.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Lockout de login en memoria (sin dependencias externas).
 *
 * Política:
 *  - Máx 5 fallos por identifier (email/username) en ventana deslizante de 15 min.
 *  - Máx 20 fallos por IP en la misma ventana.
 *  - Al alcanzar el límite: bloqueo de 15 min (HTTP 429 TOO_MANY_ATTEMPTS).
 *  - `registerSuccess` limpia los contadores del identifier y de la IP.
 *
 * Limpieza perezosa: en cada `check`, si el Map supera MAX_ENTRIES se purgan
 * las entradas expiradas (sin fallos vigentes ni bloqueo activo).
 */

type ThrottleEntry = {
  /** Timestamps (ms) de fallos dentro de la ventana deslizante */
  failures: number[];
  /** Fin del bloqueo (ms epoch), si está bloqueado */
  blockedUntil: number | null;
};

const WINDOW_MS = 15 * 60_000; // ventana deslizante de 15 min
const BLOCK_MS = 15 * 60_000; // duración del bloqueo
const MAX_PER_IDENTIFIER = 5;
const MAX_PER_IP = 20;
const MAX_ENTRIES = 10_000; // umbral para limpieza perezosa

@Injectable()
export class LoginThrottleService {
  private readonly entries = new Map<string, ThrottleEntry>();

  /** Lanza 429 TOO_MANY_ATTEMPTS si el identifier o la IP están bloqueados. */
  check(identifier: string, ip: string): void {
    this.lazyPurge();
    const now = Date.now();
    for (const key of [this.idKey(identifier), this.ipKey(ip)]) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      if (entry.blockedUntil !== null) {
        if (entry.blockedUntil > now) {
          const retryAfterSeconds = Math.ceil((entry.blockedUntil - now) / 1000);
          throw new HttpException(
            {
              code: 'TOO_MANY_ATTEMPTS',
              message: 'Too many failed login attempts. Try again later.',
              retryAfterSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        // Bloqueo expirado: reinicia la entrada
        entry.blockedUntil = null;
        entry.failures = [];
      }
    }
  }

  registerFailure(identifier: string, ip: string): void {
    this.addFailure(this.idKey(identifier), MAX_PER_IDENTIFIER);
    this.addFailure(this.ipKey(ip), MAX_PER_IP);
  }

  registerSuccess(identifier: string, ip: string): void {
    this.entries.delete(this.idKey(identifier));
    this.entries.delete(this.ipKey(ip));
  }

  // ── internos ──────────────────────────────────────────────────────────────

  private addFailure(key: string, limit: number): void {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { failures: [], blockedUntil: null };
      this.entries.set(key, entry);
    }
    // Ventana deslizante: descarta fallos fuera de la ventana
    entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
    entry.failures.push(now);
    if (entry.failures.length >= limit) {
      entry.blockedUntil = now + BLOCK_MS;
    }
  }

  private lazyPurge(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      const blocked = entry.blockedUntil !== null && entry.blockedUntil > now;
      const hasRecentFailures = entry.failures.some((t) => now - t < WINDOW_MS);
      if (!blocked && !hasRecentFailures) this.entries.delete(key);
    }
  }

  private idKey(identifier: string): string {
    return `id:${String(identifier).trim().toLowerCase()}`;
  }

  private ipKey(ip: string): string {
    return `ip:${ip || 'unknown'}`;
  }
}
