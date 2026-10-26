// src/devices/devices.module.ts
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule } from '@nestjs/config'
import { DevicesGateway } from './devices.gateway'
import { DevicesRegistry } from './devices.registry'
import { AuthSession } from '../users/entities/auth-session.entity'
import { DevicesController } from './devices.controller'
import { User } from 'src/users/entities/user.entity'
import { HandshakeCapture } from 'src/handshakes/entities/handshake-capture.entity'

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}), // usa ConfigService para verify()
    TypeOrmModule.forFeature([AuthSession, User, HandshakeCapture]),
    
  ],
  providers: [DevicesGateway, DevicesRegistry],
  controllers: [DevicesController],
  exports: [DevicesRegistry],
})
export class DevicesModule {}

/* import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
 */