// src/devices/devices.registry.ts
import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export type DevicePresence = {
    deviceId: string;
    socketId: string;
    userId: string;
    sid: string;
    connectedAt: number;
    /**
     * true = tiene turno abierto. El socket de Electron se abre al arrancar la app (canal de
     * control) y el cliente informa el turno con `shift:state`. Los clientes antiguos (sin
     * `shiftAware`) solo conectan en clock-in, por eso arrancan en true.
     */
    onShift: boolean;
};

const TAG = '[devices/registry]';
const L = (...a: any[]) => console.log(TAG, ...a);
const W = (...a: any[]) => console.warn(TAG, ...a);
const E = (...a: any[]) => console.error(TAG, ...a);

@Injectable()
export class DevicesRegistry {
    private byDevice = new Map<string, DevicePresence>();
    private bySocket = new Map<string, DevicePresence>();
    private io?: Server;

    setServer(io: Server) {
        this.io = io;
        L('setServer OK (namespace ready?)');
    }

    set(p: DevicePresence) {
        // Reconexión del mismo dispositivo: descarta el socket anterior para no dejar huérfanos.
        const prev = this.byDevice.get(p.deviceId);
        if (prev && prev.socketId !== p.socketId) this.bySocket.delete(prev.socketId);
        this.byDevice.set(p.deviceId, p);
        this.bySocket.set(p.socketId, p);
        L('set presence', p);
        this.emitPresence(p.userId);
    }

    /** Actualiza el flag de turno de la presencia ligada a un socket. */
    setOnShift(socketId: string, onShift: boolean): DevicePresence | null {
        const p = this.bySocket.get(socketId);
        if (!p) return null;
        p.onShift = onShift;
        L('setOnShift', { deviceId: p.deviceId, userId: p.userId, onShift });
        this.emitPresence(p.userId);
        return p;
    }

    /** Emite un evento a todos los sockets conectados de un usuario (fire-and-forget). */
    notifyUser(userId: string, event: string, payload: unknown): number {
        if (!this.io) return 0;
        const mine = [...this.byDevice.values()].filter(p => p.userId === userId);
        for (const p of mine) this.io.to(p.socketId).emit(event, payload);
        // Sockets web del propio usuario (Activity Report): sala `user:{id}`.
        this.io.to(`user:${userId}`).emit(event, payload);
        return mine.length;
    }

    /** Avisa a la web del usuario si su app está conectada / en turno (indicador en vivo). */
    private emitPresence(userId: string) {
        if (!this.io) return;
        const p = this.getByUser(userId);
        this.io.to(`user:${userId}`).emit('device:presence', {
            connected: !!p,
            onShift: !!p?.onShift,
        });
    }

    /** Presencia más reciente de un usuario (o null si no tiene socket conectado). */
    getByUser(userId: string): DevicePresence | null {
        const mine = [...this.byDevice.values()].filter(p => p.userId === userId);
        if (!mine.length) return null;
        return mine.sort((a, b) => b.connectedAt - a.connectedAt)[0];
    }

    /**
     * Emite a un dispositivo y espera su ack. `delivered=false` si no hay presencia o el
     * cliente no confirmó dentro del timeout (socket muerto, app colgada, sin handler).
     */
    async requestAck<T = unknown>(
        deviceId: string,
        event: string,
        payload: any,
        timeoutMs: number,
    ): Promise<{ delivered: boolean; response?: T }> {
        if (!this.io) {
            E('requestAck: io not set');
            return { delivered: false };
        }
        const item = this.byDevice.get(deviceId);
        if (!item) return { delivered: false };
        try {
            const res = await this.io.to(item.socketId).timeout(timeoutMs).emitWithAck(event, payload);
            const response = (Array.isArray(res) ? res[0] : res) as T | undefined;
            return { delivered: response !== undefined, response };
        } catch (err) {
            W('requestAck: sin ack', { deviceId, event, msg: (err as Error)?.message });
            return { delivered: false };
        }
    }

    deleteBySocket(socketId: string) {
        const p = this.bySocket.get(socketId);
        if (p) {
            this.bySocket.delete(socketId);
            // Solo borra la presencia del dispositivo si este socket sigue siendo el vigente.
            // Si la app se cerró (Exit) y reabrió, el socket viejo se desconecta DESPUÉS de que el
            // nuevo se registró: borrar aquí dejaría al usuario sin presencia ("No connection").
            const current = this.byDevice.get(p.deviceId);
            if (current?.socketId === socketId) {
                this.byDevice.delete(p.deviceId);
                W('deleteBySocket removed presence', p);
                this.emitPresence(p.userId);
            } else {
                L('deleteBySocket: socket obsoleto, la presencia vigente se conserva', {
                    stale: socketId,
                    current: current?.socketId ?? null,
                });
            }
        } else {
            W('deleteBySocket no presence for', socketId);
        }
    }

    listByUser(userId?: string) {
        const all = [...this.byDevice.values()];
        const res = userId ? all.filter(p => p.userId === userId) : all;
        L('listByUser', { userId, count: res.length });
        return res;
    }

    getByDevice(deviceId: string) {
        const v = this.byDevice.get(deviceId) || null;
        L('getByDevice', { deviceId, found: !!v });
        return v;
    }

    /** Emite a un device online usando su socketId y también a room `device:{deviceId}` */
    emitToDevice(deviceId: string, event: string, payload: any): boolean {
        if (!this.io) {
            E('emitToDevice: io not set');
            return false;
        }
        const item = this.getByDevice(deviceId);
        if (!item) {
            W('emitToDevice: device not found in registry', { deviceId });
            return false;
        }

        // verificar que el socket exista en el namespace
        const nsp = this.io; // @WebSocketServer() ya apunta al namespace /realtime
        const hasSocket = nsp.sockets?.sockets?.has(item.socketId);
        L('emitToDevice try', {
            deviceId,
            event,
            socketId: item.socketId,
            hasSocket,
        });

        // emite directo al socketId
        nsp.to(item.socketId).emit(event, payload);

        // emite también al room del device (por si el cliente escucha el room)
        nsp.to(`device:${deviceId}`).emit(event, payload);

        L('emitToDevice sent', { deviceId, event });
        return true;
    }

    /** Emite un evento a todos los sockets de una sala (p. ej. `admin:{userId}`) */
    emitToRoom(room: string, event: string, payload: any): boolean {
        if (!this.io) {
            E('emitToRoom: io not set');
            return false;
        }
        this.io.to(room).emit(event, payload);
        L('emitToRoom sent', { room, event });
        return true;
    }

    /** Emite un evento a todos los sockets del room `sid:{sid}` */
    emitToSid(sid: string, event: string, payload: any): boolean {
        if (!this.io) {
            E('emitToSid: io not set');
            return false;
        }
        this.io.to(`sid:${sid}`).emit(event, payload);
        L('emitToSid sent', { sid, event });
        return true;
    }

    /** Emite un evento a TODOS los sockets conectados al namespace */
    broadcast(event: string, payload: any): boolean {
        if (!this.io) {
            E('broadcast: io not set');
            return false;
        }
        this.io.emit(event, payload);
        L('broadcast sent', { event });
        return true;
    }

    /** Desconecta todos los sockets del room `sid:{sid}` */
    disconnectSid(sid: string): boolean {
        if (!this.io) {
            E('disconnectSid: io not set');
            return false;
        }
        this.io.in(`sid:${sid}`).disconnectSockets(true);
        L('disconnectSid done', { sid });
        return true;
    }

    /** Utilidad para debuggear desde controller si quieres */
    dump() {
        const byDev = [...this.byDevice.values()];
        const bySock = [...this.bySocket.values()];
        L('DUMP', { byDevice: byDev, bySocket: bySock });
        return { byDevice: byDev, bySocket: bySock };
    }
}
