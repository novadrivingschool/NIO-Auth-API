import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../users/entities/user.entity';
import {
  CreateScheduleDto,
  ListSchedulesQueryDto,
  ScheduleHistoryQueryDto,
  UpdateScheduleDto,
} from './dto/schedule.dto';
import { EmployeeSchedule } from './entities/employee-schedule.entity';
import { SchedulesService } from './schedules.service';

type AuthenticatedRequest = { user?: { userId?: string } };

const actorOf = (req: AuthenticatedRequest) => req.user?.userId ?? null;

@ApiTags('schedules')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requiere rol admin o super_admin' })
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
@UseGuards(RolesGuard)
@Controller('users/:userId/schedules')
export class SchedulesController {
  constructor(private readonly service: SchedulesService) {}

  @Get()
  @ApiOkResponse({ type: EmployeeSchedule, isArray: true })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  list(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: ListSchedulesQueryDto,
  ) {
    return this.service.list(userId, query);
  }

  @Get('history')
  @ApiOkResponse({ description: 'Bitácora de cambios, más reciente primero' })
  history(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: ScheduleHistoryQueryDto,
  ) {
    return this.service.history(userId, query);
  }

  @Post()
  @HttpCode(201)
  @ApiConflictResponse({ description: 'La vigencia se traslapa con otro horario' })
  create(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateScheduleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.create(userId, dto, actorOf(req));
  }

  @Patch(':scheduleId')
  @ApiConflictResponse({ description: 'La vigencia se traslapa con otro horario' })
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateScheduleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(userId, scheduleId, dto, actorOf(req));
  }

  @Delete(':scheduleId')
  @HttpCode(204)
  @ApiConflictResponse({ description: 'El horario ya inició: ciérralo en vez de borrarlo' })
  remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.remove(userId, scheduleId, actorOf(req));
  }
}
