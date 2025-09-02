// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,     // para leer JWT_* del .env via ConfigService
    UsersModule,      // AuthService usa UsersService
    JwtModule.register({}), // usaremos signAsync/verifyAsync con secretos desde ConfigService
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService],   // útil si luego otro módulo necesita AuthService
})
export class AuthModule {}
