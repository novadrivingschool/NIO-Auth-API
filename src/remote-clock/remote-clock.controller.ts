import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RemoteClockDto } from './dto/remote-clock.dto';
import { HandshakeNonceDto } from './dto/handshake.dto';
import { HANDSHAKE_MESSAGES, LocalHandshakeService } from './local-handshake.service';
import { RemoteClockService } from './remote-clock.service';

type Req_ = { user?: { userId?: string; sid?: string | null } };

/**
 * Activity Report del NIO: el empleado pide clock in / clock out y la app Electron de SU usuario
 * lo ejecuta como si lo hubiera hecho a mano. Solo tokens WEB (sin sid): Electron no se manda
 * comandos a sí mismo. JwtAuthGuard es global.
 */
@ApiTags('remote-clock')
@ApiBearerAuth()
@Controller('remote-clock')
export class RemoteClockController {
  constructor(
    private readonly service: RemoteClockService,
    private readonly handshake: LocalHandshakeService,
  ) {}

  private userIdOf(req: Req_): string {
    if (!req.user?.userId || req.user.sid) throw new ForbiddenException('Solo sesión web.');
    return req.user.userId;
  }

  @Get('status')
  @ApiOperation({ summary: 'Estado del canal de control (socket) del propio usuario' })
  status(@Req() req: Req_) {
    return this.service.status(this.userIdOf(req));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Pide a la app Electron del usuario un clock in / clock out (origen ACTIVITY_REPORT)',
    description:
      '403 EXTERNAL_MISMATCH / NO_EXTERNAL_NUMBER; 409 DEVICE_UNAVAILABLE (sin socket o sin ack), COMMAND_IN_PROGRESS o el código que devuelva la app.',
  })
  request(@Req() req: Req_, @Body() dto: RemoteClockDto) {
    return this.service.request(this.userIdOf(req), dto.external_employee_number, dto.action);
  }

  // ── Handshake "misma máquina" (ver LocalHandshakeService) ─────────────────────────────

  @Post('handshake')
  @HttpCode(200)
  @ApiOperation({ summary: 'Web: pide un nonce de un solo uso para verificar la app NIO de este equipo' })
  issueHandshake(@Req() req: Req_) {
    return this.handshake.issue(this.userIdOf(req));
  }

  @Post('handshake/redeem')
  @HttpCode(200)
  @ApiOperation({ summary: 'App Electron: canjea el nonce que le entregó la web por 127.0.0.1 (token con sid)' })
  redeemHandshake(@Req() req: Req_, @Body() dto: HandshakeNonceDto) {
    if (!req.user?.userId || !req.user.sid) throw new ForbiddenException('Solo la app de escritorio.');
    return { ok: this.handshake.redeem(req.user.userId, req.user.sid, dto.nonce) };
  }

  @Post('handshake/check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Web: evalúa las 3 validaciones para mostrar el estado (consume el nonce)' })
  checkHandshake(@Req() req: Req_, @Body() dto: HandshakeNonceDto) {
    const code = this.handshake.evaluate(this.userIdOf(req), dto.nonce);
    return code ? { ok: false, code, message: HANDSHAKE_MESSAGES[code] } : { ok: true };
  }

  @Post('handshake/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Backend NIO: exige las 3 validaciones antes de registrar un clock (409 con code si falla)',
  })
  verifyHandshake(@Req() req: Req_, @Body() dto: HandshakeNonceDto) {
    const code = this.handshake.evaluate(this.userIdOf(req), dto.nonce);
    if (code) {
      throw new HttpException({ statusCode: 409, code, message: HANDSHAKE_MESSAGES[code] }, 409);
    }
    return { ok: true };
  }
}
