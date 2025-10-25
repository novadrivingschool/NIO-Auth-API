// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

import { User } from '../users/entities/user.entity';
import { AuthSession } from '../users/entities/auth-session.entity';
import { SessionsSocketModule } from 'src/sessions-socket/sessions-socket.module';

@Module({
  imports: [
    ConfigModule, // para leer JWT_* del .env
    TypeOrmModule.forFeature([User, AuthSession]), // 👈 repos para @InjectRepository()
    UsersModule, // 👈 para inyectar UsersService en AuthService

    // JwtService disponible con secreto/ttl desde ConfigService
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_ACCESS_SECRET') ?? cfg.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: cfg.get<string>('JWT_ACCESS_TTL') ?? '15m' },
      }),
    }),
    SessionsSocketModule
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [
    AuthService,
    JwtModule,      // 👈 para que otros módulos (p. ej. DevicesModule) inyecten JwtService
    TypeOrmModule,  // (opcional) si otro módulo quiere reutilizar estos repos
  ],
})
export class AuthModule {}
