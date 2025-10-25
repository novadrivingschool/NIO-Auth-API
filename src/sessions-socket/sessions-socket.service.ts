// src/sessions-socket/sessions-socket.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io-client';

type EnsureOpts = {
  sid: string;
  token: string;      // Access JWT (SIN 'Bearer')
  deviceId: string;
  apiUrl?: string;    // override opcional
  path?: string;      // override opcional
  timeoutMs?: number; // override opcional
};

@Injectable()
export class SessionsSocketService implements OnModuleDestroy {
  private readonly log = new Logger(SessionsSocketService.name);
  private readonly sockets = new Map<string, Socket>(); // sid -> socket

  constructor(private readonly cfg: ConfigService) {}

  async ensureConnected(opts: EnsureOpts): Promise<{
    connected: boolean;
    socketId: string | null;
    url: string;
    path: string;
  }> {
    // 👇 Lee SIEMPRE de .env (y permite override por opts.* si lo mandas)
    const port = String(this.cfg.get('PORT') ?? 3000);
    const url =
      opts.apiUrl ??
      this.cfg.get<string>('WS_PUBLIC_URL') ??
      this.cfg.get<string>('BACKEND_PUBLIC_URL') ??
      this.cfg.get<string>('BACKEND_URL') ??
      `http://localhost:${port}`;

    const path = opts.path ?? this.cfg.get<string>('WS_PATH') ?? '/ws';
    const timeoutMs = opts.timeoutMs ?? Number(this.cfg.get('WS_TIMEOUT_MS') ?? 2500);

    const existing = this.sockets.get(opts.sid);
    if (existing?.connected) {
      return { connected: true, socketId: existing.id ?? null, url, path };
    }
    if (existing) {
      try { existing.disconnect(); } catch {}
      this.sockets.delete(opts.sid);
    }

    const { io } = await import('socket.io-client');
    const socket = io(url, {
      path,
      transports: ['websocket'],
      auth: { token: opts.token, deviceId: opts.deviceId }, // SIN "Bearer"
      reconnection: false,
    });

    const socketId = await new Promise<string | null>((resolve) => {
      let settled = false;
      const to = setTimeout(() => {
        if (!settled) { settled = true; resolve(null); }
      }, timeoutMs);

      socket.once('connect', () => {
        if (settled) return;
        settled = true; clearTimeout(to);
        resolve(socket.id ?? null);
      });
      socket.once('connect_error', (e: any) => {
        if (settled) return;
        settled = true; clearTimeout(to);
        this.log.warn(`connect_error sid=${opts.sid}: ${e?.message ?? e}`);
        resolve(null);
      });
    });

    if (socketId) {
      this.sockets.set(opts.sid, socket);
      socket.on('disconnect', (reason) => {
        this.log.log(`socket disconnected sid=${opts.sid} reason=${reason}`);
        this.sockets.delete(opts.sid);
      });
      socket.on('auth:force-logout', (p) => this.log.warn(`force-logout sid=${opts.sid} ${JSON.stringify(p)}`));
      socket.on('hello', (p) => this.log.log(`hello sid=${opts.sid} ${JSON.stringify(p)}`));
      return { connected: true, socketId, url, path };
    } else {
      try { socket.disconnect(); } catch {}
      return { connected: false, socketId: null, url, path };
    }
  }

  // utilidades
  isConnected(sid: string) { return this.sockets.get(sid)?.connected === true; }
  getSocketId(sid: string) { return this.sockets.get(sid)?.id ?? null; }
  disconnectSid(sid: string) {
    const s = this.sockets.get(sid);
    if (!s) return false;
    try { s.disconnect(); } catch {}
    this.sockets.delete(sid);
    return true;
  }

  onModuleDestroy() {
    for (const s of this.sockets.values()) { try { s.disconnect(); } catch {} }
    this.sockets.clear();
  }
}
