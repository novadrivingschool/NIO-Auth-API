import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { EmployeeScheduleDay } from './entities/employee-schedule-day.entity';
import { EmployeeScheduleRevision } from './entities/employee-schedule-revision.entity';
import { EmployeeSchedule } from './entities/employee-schedule.entity';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployeeSchedule,
      EmployeeScheduleDay,
      EmployeeScheduleRevision,
      User,
    ]),
  ],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
