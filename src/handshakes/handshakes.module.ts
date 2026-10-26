import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from '../devices/devices.module';
import { HandshakeCapture } from './entities/handshake-capture.entity';
import { HandshakesController } from './handshakes.controller';
import { HandshakesService } from './handshakes.service';

@Module({
  imports: [TypeOrmModule.forFeature([HandshakeCapture]), DevicesModule],
  controllers: [HandshakesController],
  providers: [HandshakesService],
})
export class HandshakesModule {}
