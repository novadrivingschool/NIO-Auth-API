/* src\devices\devices.gateway.ts */
import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    OnGatewayInit,
    SubscribeMessage,
    MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { DevicesRegistry } from './devices.registry';
import { AuthSession } from 'src/users/entities/auth-session.entity';
import { ConfigService } from '@nestjs/config';

type JwtPayload = { sub: string; sid?: string; roles?: string[] };

const TAG = '[ws/realtime]';
const L = (...a: any[]) => console.log(TAG, ...a);
const W = (...a: any[]) => console.warn(TAG, ...a);
const E = (...a: any[]) => console.error(TAG, ...a);

@WebSocketGateway({
    namespace: '/realtime',
    cors: { origin: true, credentials: true },
    path: '/socket.io',
})
export class DevicesGateway
    implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    @WebSocketServer() io: Server;

    constructor(
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
        @InjectRepository(AuthSession)
        private readonly sessionsRepo: Repository<AuthSession>,
        private readonly registry: DevicesRegistry,
    ) { }

    /** Inyecta el server de Socket.IO al registry para poder emitir */
    afterInit(server: Server) {
        this.registry.setServer(server);
        L('WS ready');
    }

    async handleConnection(@ConnectedSocket() client: Socket) {
        const start = Date.now();
        try {
            const token = (client.handshake.auth as any)?.token as string | undefined;
            if (!token) {
                W('no token → disconnect');
                return client.disconnect(true);
            }
            L('incoming', {
                id: client.id,
                ip: client.handshake.address,
                ua: client.handshake.headers['user-agent'],
            });

            // Verifica con secreto del ACCESS token
            const accessSecret =
                this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
            let payload: JwtPayload;
            try {
                payload = await this.jwt.verifyAsync<JwtPayload>(token, {
                    secret: accessSecret,
                });
            } catch (err) {
                E('jwt.verifyAsync FAIL → disconnect', { msg: (err as any)?.message });
                return client.disconnect(true);
            }

            const { sid, sub: userId, roles } = payload || ({} as JwtPayload);
            if (!userId) {
                W('payload sin sub → disconnect', payload);
                return client.disconnect(true);
            }

            // Token WEB (sin sid): no cuenta como presencia de dispositivo. Todos escuchan su sala
            // `user:{id}`; los admins además la de handshakes `admin:{id}`.
            if (!sid) {
                const isAdmin = (roles ?? []).some(r =>
                    ['admin', 'super_admin'].includes(String(r).toLowerCase()),
                );
                (client.data as any).kind = 'web';
                (client.data as any).userId = userId;
                // Todo usuario web escucha SOLO lo suyo (modo vinculado / estado de su app);
                // la sala de handshakes `admin:{id}` sigue siendo exclusiva de admins.
                await client.join(`user:${userId}`);
                if (isAdmin) await client.join(`admin:${userId}`);
                client.emit('connected', { ok: true, kind: 'web', socketId: client.id });
                L('WEB ADMIN CONNECTED', { id: client.id, userId });
                return;
            }

            // La sesión debe existir/estar activa y tener deviceId
            const session = await this.sessionsRepo.findOne({
                where: { id: sid, userId, isActive: true, revokedAt: IsNull() },
            });
            if (!session?.deviceId) {
                W('session not found/invalid → disconnect', { sid, userId });
                return client.disconnect(true);
            }

            const deviceId: string = session.deviceId;

            // Guarda en data para el disconnect
            (client.data as any).userId = userId;
            (client.data as any).deviceId = deviceId;
            (client.data as any).sid = sid;

            // Rooms útiles
            await client.join(`sid:${sid}`);
            await client.join(`device:${deviceId}`);
            await client.join(`user:${userId}`);

            // Presencia
            this.registry.set({
                deviceId,
                socketId: client.id,
                userId,
                sid,
                connectedAt: Date.now(),
                // Cliente nuevo (shiftAware): el socket es canal de control y arranca fuera de turno.
                onShift: !((client.handshake.auth as any)?.shiftAware === true),
                onLunch: false,
            });

            client.emit('connected', {
                ok: true,
                socketId: client.id,
                deviceId,
            });
            L('CONNECTED', {
                id: client.id,
                userId,
                deviceId,
                tookMs: Date.now() - start,
            });
        } catch (err) {
            E('handleConnection error → disconnect', { msg: (err as any)?.message });
            client.disconnect(true);
        }
    }

    /** El cliente informa si tiene turno abierto (clock-in / resume = true, clock-out = false). */
    @SubscribeMessage('shift:state')
    handleShiftState(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { onShift?: unknown },
    ) {
        if ((client.data as any)?.kind === 'web') return { ok: false };
        const p = this.registry.setOnShift(client.id, body?.onShift === true);
        return { ok: !!p };
    }

    /** La app informa si el empleado está en lunch (go to lunch = true, back to lunch / clock-out = false). */
    @SubscribeMessage('lunch:state')
    handleLunchState(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { onLunch?: unknown },
    ) {
        if ((client.data as any)?.kind === 'web') return { ok: false };
        const p = this.registry.setOnLunch(client.id, body?.onLunch === true);
        return { ok: !!p };
    }

    handleDisconnect(@ConnectedSocket() client: Socket) {
        const { userId, deviceId, sid, kind } = (client.data ?? {}) as any;
        if (kind === 'web') {
            L('WEB ADMIN DISCONNECTED', { id: client.id, userId });
            return;
        }
        this.registry.deleteBySocket(client.id);
        W('DISCONNECTED', { id: client.id, userId, deviceId, sid });
    }
}
