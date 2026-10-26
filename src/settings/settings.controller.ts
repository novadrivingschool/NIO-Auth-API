import { Body, Controller, ForbiddenException, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UpdateCaptureIntervalDto } from './dto/update-capture-interval.dto';
import { SettingsService } from './settings.service';

const ADMIN_ROLES = ['admin', 'super_admin'];

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Lo lee cualquier usuario autenticado (la app de escritorio lo necesita). */
  @Get('capture-interval')
  @ApiOperation({ summary: 'Intervalo global de registro de actividad/capturas' })
  getCaptureInterval() {
    return this.settings.getCaptureInterval();
  }

  /** Solo admin / super_admin. */
  @Put('capture-interval')
  @ApiOperation({ summary: 'Cambia el intervalo global (se propaga a todos los dispositivos)' })
  updateCaptureInterval(@Req() req: Request, @Body() dto: UpdateCaptureIntervalDto) {
    const me = req.user as { userId?: string; roles?: string[] } | undefined;
    const isAdmin = (me?.roles ?? []).some((r) => ADMIN_ROLES.includes(String(r).toLowerCase()));
    if (!isAdmin) throw new ForbiddenException('Solo un administrador puede cambiar este valor');
    return this.settings.setCaptureInterval(dto.seconds, me?.userId ?? null);
  }
}
