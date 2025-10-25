// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AuthSession } from '../../users/entities/auth-session.entity'

type JWTPayload = {
  sub: string            // userId
  email?: string
  roles?: string[]
  sid?: string           // sessionId (solo lo incluimos en access de Electron)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(AuthSession)
    private readonly sessionsRepo: Repository<AuthSession>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    })
  }

  async validate(payload: JWTPayload) {
    const { sub: userId, sid, roles = [], email } = payload
    if (!userId) throw new UnauthorizedException('Invalid token payload')

    // Si el token incluye SID, lo tratamos como token de Electron y validamos sesión activa
    if (sid) {
      const session = await this.sessionsRepo.findOne({ where: { id: sid } })
      if (!session || !session.isActive || session.revokedAt) {
        throw new UnauthorizedException('Session revoked')
      }
    }

    // Lo que viaja en req.user
    return {
      userId,
      email: email ?? null,
      roles,
      sid: sid ?? null,
    }
  }
}


/* import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(config: ConfigService) {
        const secret = config.getOrThrow<string>('JWT_ACCESS_SECRET'); // <-- nunca undefined
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: secret,
        });
    }

    async validate(payload: any) {
        return { userId: payload.sub, email: payload.email, roles: payload.roles ?? [] };
    }
}
 */