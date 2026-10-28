import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CreateHandshakeDto } from './dto/create-handshake.dto';
import { HandshakeFailDto, HandshakeResultDto } from './dto/handshake-result.dto';
import { HandshakesService } from './handshakes.service';

const ADMIN_ROLES = ['admin', 'super_admin'];

type AuthUser = { userId?: string; roles?: string[] };

function me(req: Request): AuthUser {
  return (req.user as AuthUser | undefined) ?? {};
}

function assertAdmin(req: Request): string {
  const u = me(req);
  const isAdmin = (u.roles ?? []).some((r) => ADMIN_ROLES.includes(String(r).toLowerCase()));
  if (!isAdmin || !u.userId) throw new ForbiddenException('Solo un administrador');
  return u.userId;
}

function requireUser(req: Request): string {
  const id = me(req).userId;
  if (!id) throw new ForbiddenException('Usuario no identificado');
  return id;
}

@ApiTags('Handshakes')
@Controller('handshakes')
export class HandshakesController {
  constructor(private readonly handshakes: HandshakesService) {}

  @Post()
  @ApiOperation({ summary: 'Admin: pide captura + actividad a un dispositivo conectado' })
  create(@Req() req: Request, @Body() dto: CreateHandshakeDto) {
    return this.handshakes.request(assertAdmin(req), dto.targetUserId);
  }

  @Post('ping')
  @ApiOperation({ summary: 'Admin: prueba la conexión con un dispositivo (animación, sin captura)' })
  ping(@Req() req: Request, @Body() dto: CreateHandshakeDto) {
    return this.handshakes.ping(assertAdmin(req), dto.targetUserId);
  }

  @Get()
  @ApiOperation({ summary: 'Admin: historial de handshakes de un usuario' })
  list(@Req() req: Request, @Query('userId', new ParseUUIDPipe()) userId: string) {
    assertAdmin(req);
    return this.handshakes.list(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Admin: detalle de un handshake' })
  get(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    assertAdmin(req);
    return this.handshakes.get(id);
  }

  @Post(':id/result')
  @ApiOperation({ summary: 'Dispositivo: entrega captura y actividad' })
  result(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: HandshakeResultDto,
  ) {
    return this.handshakes.complete(id, requireUser(req), dto);
  }

  @Post(':id/fail')
  @ApiOperation({ summary: 'Dispositivo: no pudo capturar' })
  fail(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: HandshakeFailDto,
  ) {
    return this.handshakes.fail(id, requireUser(req), dto);
  }
}
