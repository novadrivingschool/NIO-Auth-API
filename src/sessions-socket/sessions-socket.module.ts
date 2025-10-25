// src/sessions-socket/sessions-socket.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SessionsSocketService } from './sessions-socket.service';

@Module({
  imports: [ConfigModule],
  providers: [SessionsSocketService],
  exports: [SessionsSocketService],
})
export class SessionsSocketModule {}
