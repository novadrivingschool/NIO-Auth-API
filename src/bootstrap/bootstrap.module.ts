// src/bootstrap/bootstrap.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BootstrapService } from './bootstrap.service';
import { User } from 'src/users/entities/user.entity';
import { UsersModule } from 'src/users/users.module';
//import { User } from '@/users/entities/user.entity';
//import { UsersModule } from '@/users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), UsersModule],
  providers: [BootstrapService],
})
export class BootstrapModule {}
