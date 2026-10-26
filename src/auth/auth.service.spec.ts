// Mockear módulos nativos ANTES de cualquier import que los cargue
// (evita cargar bindings compilados para otra plataforma).
jest.mock('argon2', () => ({ hash: jest.fn(), verify: jest.fn() }));
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { AuthSession } from '../users/entities/auth-session.entity';
import { SessionsSocketService } from '../sessions-socket/sessions-socket.service';
import { DevicesRegistry } from '../devices/devices.registry';

const argon2Mock = argon2 as jest.Mocked<typeof argon2>;
const bcryptMock = bcrypt as jest.Mocked<typeof bcrypt>;

const IP = '10.0.0.1';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'john@example.com',
    passwordHash: 'bcrypt-hash',
    roles: ['user'],
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    profile: undefined,
    ...overrides,
  } as unknown as User;
}

function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    id: 'sid-1',
    userId: 'user-1',
    client: 'electron',
    deviceId: 'device-1234567890',
    label: 'PC Recepción',
    refreshTokenHash: 'argon2-hash',
    lastUsedAt: new Date(),
    revokedAt: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as unknown as AuthSession;
}

describe('AuthService', () => {
  let service: AuthService;
  let throttle: LoginThrottleService;

  const usersRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const sessionsRepo = {
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn((v: Partial<AuthSession>) => ({ ...v })),
    save: jest.fn(async (s: AuthSession) => s),
  };
  const usersService = { updateRefreshToken: jest.fn() };
  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_TTL') return '15m';
      if (key === 'JWT_REFRESH_TTL') return '7d';
      return undefined;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return 'test_access_secret';
      if (key === 'JWT_REFRESH_SECRET') return 'test_refresh_secret';
      throw new Error(`missing config ${key}`);
    }),
  };
  const socketsService = { ensureConnected: jest.fn() };
  const registry = {
    emitToSid: jest.fn().mockReturnValue(true),
    disconnectSid: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        LoginThrottleService, // real: permite probar el lockout end-to-end
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(AuthSession), useValue: sessionsRepo },
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: SessionsSocketService, useValue: socketsService },
        { provide: DevicesRegistry, useValue: registry },
      ],
    }).compile();

    service = module.get(AuthService);
    throttle = module.get(LoginThrottleService);
  });

  // ────────────────────────────────────────── login ──────────────────────────
  describe('login', () => {
    it('lanza BAD_CREDENTIALS y registra el fallo si el usuario no existe', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      const failureSpy = jest.spyOn(throttle, 'registerFailure');

      const dto = { email: 'nobody@example.com', password: 'Password123' } as any;

      await expect(service.login(dto, IP)).rejects.toMatchObject({
        response: { code: 'BAD_CREDENTIALS' },
      });
      await expect(service.login(dto, IP)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(failureSpy).toHaveBeenCalledWith('nobody@example.com', IP);
    });

    it('lanza BAD_CREDENTIALS y registra el fallo si la contraseña es incorrecta', async () => {
      usersRepo.findOne.mockResolvedValue(makeUser());
      (bcryptMock.compare as jest.Mock).mockResolvedValue(false);
      const failureSpy = jest.spyOn(throttle, 'registerFailure');

      await expect(
        service.login({ email: 'john@example.com', password: 'wrongpass1' } as any, IP),
      ).rejects.toMatchObject({ response: { code: 'BAD_CREDENTIALS' } });
      expect(failureSpy).toHaveBeenCalledWith('john@example.com', IP);
    });

    it('electron: revoca la sesión previa, emite force-logout y retorna tokens con session', async () => {
      const user = makeUser();
      const prev = makeSession({ id: 'sid-old', deviceId: 'device-old-1234567890' });
      const current = makeSession({ id: 'sid-new', refreshTokenHash: null });

      usersRepo.findOne.mockResolvedValue(user);
      (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
      sessionsRepo.count.mockResolvedValue(1);
      sessionsRepo.findOne
        .mockResolvedValueOnce(prev) // sesión activa previa
        .mockResolvedValueOnce(current); // upsert
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      (argon2Mock.hash as jest.Mock).mockResolvedValue('argon2-new-hash');

      const dto = {
        email: 'john@example.com',
        password: 'Password123',
        deviceId: 'device-1234567890',
        label: 'PC Recepción',
      } as any;

      const res = await service.login(dto, IP);

      // Sesión previa revocada
      expect(prev.isActive).toBe(false);
      expect(prev.revokedAt).toBeInstanceOf(Date);
      expect(prev.refreshTokenHash).toBeNull();
      expect(sessionsRepo.save).toHaveBeenCalledWith(prev);

      // Force-logout emitido a la sesión previa
      expect(registry.emitToSid).toHaveBeenCalledWith(
        'sid-old',
        'auth:force-logout',
        expect.objectContaining({
          reason: 'NEW_LOGIN',
          deviceId: 'device-1234567890',
        }),
      );
      expect(registry.disconnectSid).toHaveBeenCalledWith('sid-old');

      // Tokens y sesión retornados
      expect(res.tokens).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(res.session).toEqual({
        id: 'sid-new',
        client: 'electron',
        deviceId: 'device-1234567890',
        label: 'PC Recepción',
      });
      expect(current.refreshTokenHash).toBe('argon2-new-hash');
    });

    it('electron: un fallo al emitir force-logout NO rompe el login', async () => {
      const user = makeUser();
      const prev = makeSession({ id: 'sid-old' });
      const current = makeSession({ id: 'sid-new' });

      usersRepo.findOne.mockResolvedValue(user);
      (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
      sessionsRepo.count.mockResolvedValue(1);
      sessionsRepo.findOne
        .mockResolvedValueOnce(prev)
        .mockResolvedValueOnce(current);
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      (argon2Mock.hash as jest.Mock).mockResolvedValue('h');
      registry.emitToSid.mockImplementationOnce(() => {
        throw new Error('io not ready');
      });

      const res = await service.login(
        {
          email: 'john@example.com',
          password: 'Password123',
          deviceId: 'device-1234567890',
          label: 'PC',
        } as any,
        IP,
      );
      expect(res.tokens.accessToken).toBe('access-token');
    });

    it('con throttle bloqueado (5 fallos) lanza 429 TOO_MANY_ATTEMPTS sin tocar la BD', async () => {
      for (let i = 0; i < 5; i++) {
        throttle.registerFailure('locked@example.com', IP);
      }

      let caught: HttpException | undefined;
      try {
        await service.login(
          { email: 'locked@example.com', password: 'Password123' } as any,
          IP,
        );
      } catch (e) {
        caught = e as HttpException;
      }

      expect(caught).toBeInstanceOf(HttpException);
      expect(caught!.getStatus()).toBe(429);
      expect(caught!.getResponse()).toMatchObject({
        code: 'TOO_MANY_ATTEMPTS',
        retryAfterSeconds: expect.any(Number),
      });
      expect(usersRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────── refresh ─────────────────────────
  describe('refresh (electron)', () => {
    const OLD_REFRESH = 'old-refresh-token';

    function setupElectronPayload(sid = 'sid-1', sub = 'user-1') {
      jwtService.verifyAsync.mockResolvedValue({ sub, sid });
    }

    it('camino feliz: rota tokens, actualiza hash y lastUsedAt', async () => {
      setupElectronPayload();
      const session = makeSession({ lastUsedAt: new Date(Date.now() - 120_000) });
      sessionsRepo.findOne.mockResolvedValue(session);
      (argon2Mock.verify as jest.Mock).mockResolvedValue(true);
      usersRepo.findOne.mockResolvedValue(makeUser());
      jwtService.signAsync
        .mockResolvedValueOnce('new-access')
        .mockResolvedValueOnce('new-refresh');
      (argon2Mock.hash as jest.Mock).mockResolvedValue('argon2-rotated-hash');

      const before = Date.now();
      const res = await service.refresh(OLD_REFRESH);

      expect(res).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
      expect(argon2Mock.hash).toHaveBeenCalledWith('new-refresh');
      expect(session.refreshTokenHash).toBe('argon2-rotated-hash');
      expect(session.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(session.isActive).toBe(true);
      expect(sessionsRepo.save).toHaveBeenCalledWith(session);
    });

    it('hash mismatch con rotación hace 10s → REFRESH_STALE y NO revoca la sesión', async () => {
      setupElectronPayload();
      const session = makeSession({ lastUsedAt: new Date(Date.now() - 10_000) });
      sessionsRepo.findOne.mockResolvedValue(session);
      (argon2Mock.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.refresh(OLD_REFRESH)).rejects.toMatchObject({
        response: { code: 'REFRESH_STALE' },
      });

      expect(session.isActive).toBe(true);
      expect(session.revokedAt).toBeNull();
      expect(sessionsRepo.save).not.toHaveBeenCalled();
    });

    it('token ANTERIOR dentro de la ventana prev → acepta, rota de nuevo y desplaza el hash', async () => {
      setupElectronPayload();
      const session = makeSession({
        refreshTokenHash: 'hash-current',
        prevRefreshTokenHash: 'hash-prev',
        prevRotatedAt: new Date(Date.now() - 2 * 60_000),
        lastUsedAt: new Date(Date.now() - 2 * 60_000),
      });
      sessionsRepo.findOne.mockResolvedValue(session);
      usersRepo.findOne.mockResolvedValue(makeUser());
      (argon2Mock.verify as jest.Mock).mockImplementation(async (hash: string) => hash === 'hash-prev');
      (argon2Mock.hash as jest.Mock).mockResolvedValue('hash-new');

      const res = await service.refresh(OLD_REFRESH);

      expect(res.refreshToken).toBeDefined();
      expect(session.prevRefreshTokenHash).toBe('hash-current');
      expect(session.refreshTokenHash).toBe('hash-new');
      expect(session.isActive).toBe(true);
    });

    it('token anterior FUERA de la ventana prev → revoca + INVALID_REFRESH', async () => {
      setupElectronPayload();
      const session = makeSession({
        refreshTokenHash: 'hash-current',
        prevRefreshTokenHash: 'hash-prev',
        prevRotatedAt: new Date(Date.now() - 10 * 60_000),
        lastUsedAt: new Date(Date.now() - 10 * 60_000),
      });
      sessionsRepo.findOne.mockResolvedValue(session);
      (argon2Mock.verify as jest.Mock).mockImplementation(async (hash: string) => hash === 'hash-prev');

      await expect(service.refresh(OLD_REFRESH)).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH' },
      });
      expect(session.isActive).toBe(false);
    });

    it('hash mismatch con rotación hace 5 min → revoca la sesión + INVALID_REFRESH', async () => {
      setupElectronPayload();
      const session = makeSession({ lastUsedAt: new Date(Date.now() - 5 * 60_000) });
      sessionsRepo.findOne.mockResolvedValue(session);
      (argon2Mock.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.refresh(OLD_REFRESH)).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH' },
      });

      expect(session.isActive).toBe(false);
      expect(session.revokedAt).toBeInstanceOf(Date);
      expect(session.refreshTokenHash).toBeNull();
      expect(sessionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sid-1', isActive: false }),
      );
    });

    it('deviceId distinto al de la sesión → DEVICE_MISMATCH y sesión revocada', async () => {
      setupElectronPayload();
      const session = makeSession({ deviceId: 'device-legit-1234567890' });
      sessionsRepo.findOne.mockResolvedValue(session);

      await expect(
        service.refresh(OLD_REFRESH, 'device-EVIL-1234567890'),
      ).rejects.toMatchObject({ response: { code: 'DEVICE_MISMATCH' } });

      expect(session.isActive).toBe(false);
      expect(session.revokedAt).toBeInstanceOf(Date);
      expect(sessionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sid-1', isActive: false }),
      );
      // Nunca llegó a verificar el hash
      expect(argon2Mock.verify).not.toHaveBeenCalled();
    });

    it('sesión revocada/inexistente → SESSION_REVOKED', async () => {
      setupElectronPayload();
      sessionsRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh(OLD_REFRESH)).rejects.toMatchObject({
        response: { code: 'SESSION_REVOKED' },
      });
    });

    it('sin refresh token → MISSING_REFRESH', async () => {
      await expect(service.refresh('')).rejects.toMatchObject({
        response: { code: 'MISSING_REFRESH' },
      });
    });

    it('firma inválida → INVALID_REFRESH', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
      await expect(service.refresh('garbage')).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH' },
      });
    });
  });
});
