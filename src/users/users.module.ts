import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';

@Module({
  imports: [
    // Registra la entity en este módulo
    TypeOrmModule.forFeature([User, UserProfile]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // útil si luego AuthModule usa UsersService
})
export class UsersModule {}
