// src/devices/devices.registry.ts
import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export type DevicePresence = {
    deviceId: string;
    socketId: string;
    userId: string;
    sid: string;
    connectedAt: number;
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
        this.byDevice.set(p.deviceId, p);
        this.bySocket.set(p.socketId, p);
        L('set presence', p);
    }

    deleteBySocket(socketId: string) {
        const p = this.bySocket.get(socketId);
        if (p) {
            this.bySocket.delete(socketId);
            this.byDevice.delete(p.deviceId);
            W('deleteBySocket removed presence', p);
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

    /** Utilidad para debuggear desde controller si quieres */
    dump() {
        const byDev = [...this.byDevice.values()];
        const bySock = [...this.bySocket.values()];
        L('DUMP', { byDevice: byDev, bySocket: bySock });
        return { byDevice: byDev, bySocket: bySock };
    }
}
