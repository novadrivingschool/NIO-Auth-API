import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from '../devices/devices.module';
import { User } from '../users/entities/user.entity';
import { RemoteClockController } from './remote-clock.controller';
import { RemoteClockService } from './remote-clock.service';
import { LocalHandshakeService } from './local-handshake.service';

@Module({
  imports: [ConfigModule, DevicesModule, TypeOrmModule.forFeature([User])],
  controllers: [RemoteClockController],
  providers: [RemoteClockService, LocalHandshakeService],
})
export class RemoteClockModule {}
