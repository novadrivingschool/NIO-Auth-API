import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as argon2 from 'argon2';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { LoginWebDto } from './dto/login-web.dto';
import { TokensDto } from './dto/tokens.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserDto } from './dto/user.dto';
import { AuthSession } from 'src/users/entities/auth-session.entity';
import { User } from 'src/users/entities/user.entity';
import { SessionsSocketService } from 'src/sessions-socket/sessions-socket.service';
import { DevicesRegistry } from 'src/devices/devices.registry';
import { LoginThrottleService } from './login-throttle.service';

type JwtPayload = {
  sub: string;
  email: string;
  roles: string[];
};

/** Ventana de gracia para refreshes concurrentes legítimos (rotación reciente). */
const GRACE_MS = 60_000;

/**
 * Ventana en la que el refresh token INMEDIATAMENTE anterior sigue siendo aceptable
 * (rotándolo de nuevo). Cubre al cliente que perdió la respuesta del refresh anterior.
 */
const PREV_GRACE_MS = 5 * 60_000;

@Injectable()
export class AuthService {
  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(AuthSession)
    private sessionsRepo: Repository<AuthSession>,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sockets: SessionsSocketService,
    private readonly registry: DevicesRegistry,
    private readonly throttle: LoginThrottleService,
  ) {
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    this.refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    this.accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers Electron (session-based)
  // ────────────────────────────────────────────────────────────────────────────
  private async signAccessElectron(user: User, sid: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, sid, roles: user.roles, email: user.email },
      { secret: this.accessSecret, expiresIn: this.accessTtl },
    );
  }

  private async signRefreshElectron(
    sid: string,
    userId: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid },
      { secret: this.refreshSecret, expiresIn: this.refreshTtl },
    );
  }

  private async hasActiveElectronSession(userId: string): Promise<boolean> {
    const count = await this.sessionsRepo.count({
      where: {
        userId,
        client: 'electron',
        isActive: true,
        revokedAt: IsNull(),
      },
    });
    return count > 0;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Sesión WEB: tokens sin `sid`, hash del refresh en la tabla `users`.
  // Compartido por `login()` (rama web legacy) y `loginWeb()`.
  // ────────────────────────────────────────────────────────────────────────────
  private async issueWebSession(
    user: User,
  ): Promise<Omit<AuthResponseDto, 'session'>> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, roles: user.roles, email: user.email },
      { secret: this.accessSecret, expiresIn: this.accessTtl },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id },
      { secret: this.refreshSecret, expiresIn: this.refreshTtl },
    );

    // ⬅️ **IMPORTANTE**: guardar hash del refresh en users (bcrypt)
    await this.users.updateRefreshToken(user.id, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email ?? '',
        roles: user.roles,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
        avatarUrl: user.profile?.avatarUrl,
        employee_number: user.profile?.employee_number,
      },
      tokens: { accessToken, refreshToken },
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Login WEB por employee_number (endpoint dedicado del front Vue).
  // No toca `auth_sessions` ni emite `sid`, por lo que no interfiere con
  // las sesiones de Electron del mismo usuario.
  // ────────────────────────────────────────────────────────────────────────────
  async loginWeb(
    dto: LoginWebDto,
    ip: string = 'unknown',
  ): Promise<AuthResponseDto> {
    const employeeNumber = String(dto.employeeNumber).trim().toUpperCase();

    // Lockout: bloquea si hay demasiados intentos fallidos recientes
    this.throttle.check(employeeNumber, ip);

    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .innerJoinAndSelect('user.profile', 'profile')
      .where('UPPER(profile.employee_number) = :employeeNumber', {
        employeeNumber,
      })
      .andWhere('user.isActive = true')
      .getOne();

    // Mismo error y mismo coste aproximado exista o no el usuario, para no
    // filtrar qué employee_number están dados de alta.
    if (!user) {
      this.throttle.registerFailure(employeeNumber, ip);
      throw new UnauthorizedException({
        code: 'BAD_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      this.throttle.registerFailure(employeeNumber, ip);
      throw new UnauthorizedException({
        code: 'BAD_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    this.throttle.registerSuccess(employeeNumber, ip);

    return this.issueWebSession(user);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Login unificado: WEB (sin deviceId/label) vs ELECTRON (con deviceId+label)
  // ────────────────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ip: string = 'unknown'): Promise<
    AuthResponseDto & {
      session?: {
        id: string;
        client: 'electron';
        deviceId: string;
        label: string | null;
      };
      debug?: {
        hadActiveElectronBefore: boolean;
        revokedElectronSid: string | null;
      };
    }
  > {
    const identifier = String(dto.email).trim().toLowerCase();

    // Lockout: bloquea si hay demasiados intentos fallidos recientes
    this.throttle.check(identifier, ip);

    // Login solo por employee_number (case-insensitive)
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect(['user.passwordHash'])
      .innerJoinAndSelect('user.profile', 'profile')
      .where('UPPER(profile.employee_number) = :employeeNumber', {
        employeeNumber: identifier.toUpperCase(),
      })
      .andWhere('user.isActive = true')
      .getOne();

    if (!user) {
      this.throttle.registerFailure(identifier, ip);
      throw new UnauthorizedException({
        code: 'BAD_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      this.throttle.registerFailure(identifier, ip);
      throw new UnauthorizedException({
        code: 'BAD_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    this.throttle.registerSuccess(identifier, ip);

    const isElectron = !!dto.deviceId && !!dto.label && dto.label.length > 0;

    // ─────────── WEB (tokens sin sid, refresh en tabla users) ───────────
    if (!isElectron) {
      return this.issueWebSession(user);
    }

    // ─────────── ELECTRON (tokens con sid, refresh en auth_sessions) ───────────
    const hadActiveBefore =
      (await this.sessionsRepo.count({
        where: {
          userId: user.id,
          client: 'electron',
          isActive: true,
          revokedAt: IsNull(),
        },
      })) > 0;

    // Revocar anterior (si existe)
    const prev = await this.sessionsRepo.findOne({
      where: {
        userId: user.id,
        client: 'electron',
        isActive: true,
        revokedAt: IsNull(),
      },
    });
    let revokedSid: string | null = null;
    if (prev) {
      prev.isActive = false;
      prev.revokedAt = new Date();
      prev.refreshTokenHash = null;
      await this.sessionsRepo.save(prev);
      revokedSid = prev.id;

      // Notificar al cliente de la sesión revocada y desconectarlo (best-effort)
      try {
        this.registry.emitToSid(prev.id, 'auth:force-logout', {
          reason: 'NEW_LOGIN',
          deviceId: dto.deviceId,
          at: new Date().toISOString(),
        });
        this.registry.disconnectSid(prev.id);
      } catch {}
    }

    // Upsert sesión actual
    let session = await this.sessionsRepo.findOne({
      where: { userId: user.id, client: 'electron' },
    });
    if (!session)
      session = this.sessionsRepo.create({
        userId: user.id,
        client: 'electron',
      });
    session.deviceId = dto.deviceId!;
    session.label = dto.label ?? session.label ?? null;
    session.isActive = true;
    session.revokedAt = null;
    session.lastUsedAt = new Date();
    session = await this.sessionsRepo.save(session);

    // Tokens con SID
    const accessToken = await this.signAccessElectron(user, session.id);
    const refreshToken = await this.signRefreshElectron(session.id, user.id);

    // Guardar hash del refresh en la sesión (argon2)
    session.refreshTokenHash = await argon2.hash(refreshToken);
    session.lastUsedAt = new Date();
    await this.sessionsRepo.save(session);

    return {
      user: {
        id: user.id,
        email: user.email ?? '',
        roles: user.roles,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
        avatarUrl: user.profile?.avatarUrl,
        employee_number: user.profile?.employee_number,
      },
      tokens: { accessToken, refreshToken },
      session: {
        id: session.id,
        client: 'electron',
        deviceId: session.deviceId,
        label: session.label ?? null,
      },
      debug: {
        hadActiveElectronBefore: hadActiveBefore,
        revokedElectronSid: revokedSid,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Refresh unificado: ELECTRON (sid) vs WEB (sin sid)
  // ────────────────────────────────────────────────────────────────────────────
  async refresh(refreshToken: string, deviceId?: string): Promise<TokensDto> {
    if (!refreshToken) {
      throw new UnauthorizedException({
        code: 'MISSING_REFRESH',
        message: 'Missing refresh token',
      });
    }

    // Verificar firma/exp
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH',
        message: 'Invalid refresh token',
      });
    }

    // ELECTRON (con sid en payload)
    if (payload.sid) {
      const sid = String(payload.sid);
      const session = await this.sessionsRepo.findOne({
        where: { id: sid, isActive: true },
      });
      if (!session || session.revokedAt) {
        throw new UnauthorizedException({
          code: 'SESSION_REVOKED',
          message: 'Session revoked',
        });
      }

      // Device binding: el refresh debe venir del mismo dispositivo de la sesión
      if (deviceId && session.deviceId !== deviceId) {
        session.isActive = false;
        session.revokedAt = new Date();
        session.refreshTokenHash = null;
        await this.sessionsRepo.save(session);
        throw new UnauthorizedException({
          code: 'DEVICE_MISMATCH',
          message: 'Refresh token bound to another device',
        });
      }

      const matchesCurrent =
        !!session.refreshTokenHash &&
        (await argon2.verify(session.refreshTokenHash, refreshToken));

      // El cliente pudo perder la respuesta del refresh anterior (crash/reinicio):
      // acepta el token inmediatamente anterior dentro de PREV_GRACE_MS y rota de nuevo.
      // El token anterior queda invalidado al rotar (prev pasa a ser el actual).
      const prevAgeOk =
        !!session.prevRotatedAt &&
        Date.now() - session.prevRotatedAt.getTime() < PREV_GRACE_MS;
      const matchesPrev =
        !matchesCurrent &&
        prevAgeOk &&
        !!session.prevRefreshTokenHash &&
        (await argon2.verify(session.prevRefreshTokenHash, refreshToken));

      if (!matchesCurrent && !matchesPrev) {
        // Grace window anti-race: si la rotación fue hace muy poco, es muy
        // probable que sea un refresh concurrente legítimo del mismo cliente
        // que llegó con el token anterior. No revocamos; el cliente debe
        // reintentar con el token más nuevo.
        const lastUsed = session.lastUsedAt?.getTime();
        if (lastUsed && Date.now() - lastUsed < GRACE_MS) {
          throw new UnauthorizedException({
            code: 'REFRESH_STALE',
            message: 'Refresh token rotated by a concurrent request',
          });
        }

        // Fuera de la ventana de gracia: reuse sospechoso → invalida la sesión
        session.isActive = false;
        session.revokedAt = new Date();
        session.refreshTokenHash = null;
        session.prevRefreshTokenHash = null;
        session.prevRotatedAt = null;
        await this.sessionsRepo.save(session);
        throw new UnauthorizedException({
          code: 'INVALID_REFRESH',
          message: 'Invalid refresh token',
        });
      }

      const user = await this.usersRepo.findOne({
        where: { id: session.userId, isActive: true },
      });
      if (!user)
        throw new UnauthorizedException({
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        });

      const accessToken = await this.signAccessElectron(user, sid);
      const newRefresh = await this.signRefreshElectron(sid, user.id);

      session.prevRefreshTokenHash = session.refreshTokenHash;
      session.prevRotatedAt = new Date();
      session.refreshTokenHash = await argon2.hash(newRefresh);
      session.lastUsedAt = new Date();
      await this.sessionsRepo.save(session);

      return { accessToken, refreshToken: newRefresh };
    }

    // WEB (sin sid → valida contra users.refresh_token_hash con bcrypt)
    // ¡OJO!: si tu entidad User tiene `refreshTokenHash` con select:false,
    // hay que incluirlo explícitamente:
    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.refreshTokenHash')
      .where('u.id = :id AND u.isActive = true', { id: payload.sub })
      .getOne();

    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH',
        message: 'Invalid refresh token',
      });
    }

    if (!user.refreshTokenHash) {
      // Mensaje explícito para el front en caso de colisión WEB/ELECTRON o logout
      throw new UnauthorizedException({
        code: 'REFRESH_NOT_FOUND',
        message:
          'Refresh token not found. Posible colisión WEB/ELECTRON (otro cliente rotó o revocó tu refresh) o hiciste logout.',
      });
    }

    const match = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!match) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH',
        message: 'Invalid refresh token',
      });
    }

    // Rotar tokens y guardar nuevo hash
    const tokens = await this.signTokens({
      sub: user.id,
      email: user.email ?? '',
      roles: user.roles,
    });
    await this.users.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Logout: Electron (revoca sesión por sid) o Web (limpia refresh del user)
  // ────────────────────────────────────────────────────────────────────────────
  async logout(userId?: string, sid?: string) {
    if (!userId)
      throw new UnauthorizedException({
        code: 'MISSING_USER',
        message: 'Missing user',
      });

    const hadActiveBefore = await this.hasActiveElectronSession(userId);

    let revokedElectronSid: string | null = null;
    let webRefreshCleared = false;

    if (sid) {
      const session = await this.sessionsRepo.findOne({
        where: { id: sid, userId },
      });
      if (session && session.isActive && !session.revokedAt) {
        session.isActive = false;
        session.revokedAt = new Date();
        session.refreshTokenHash = null;
        await this.sessionsRepo.save(session);
        revokedElectronSid = session.id;
      }
    } else {
      await this.users.updateRefreshToken(userId, null);
      webRefreshCleared = true;
    }

    const hasActiveAfter = await this.hasActiveElectronSession(userId);

    return {
      userId,
      sid,
      revokedElectronSid,
      hadActiveElectronBefore: hadActiveBefore,
      hasActiveElectronAfter: hasActiveAfter,
      webRefreshCleared,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers genéricos
  // ────────────────────────────────────────────────────────────────────────────
  private async signTokens(payload: JwtPayload): Promise<TokensDto> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.accessSecret,
        expiresIn: this.accessTtl,
      }),
      this.jwt.signAsync(payload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtl,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private toUserDto(u: any): UserDto {
    return {
      id: u.id,
      email: u.email,
      roles: u.roles,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      firstName: u.profile?.firstName,
      lastName: u.profile?.lastName,
      avatarUrl: u.profile?.avatarUrl,
    };
  }

  async getUserWithProfile(userId: string) {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['profile'],
    });
    return user;
  }
}
