import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminEmployeeDto, AdminScreenshotDto, LUNCH_ACTIONS, RemoteClockDto } from './dto/remote-clock.dto';
import { HandshakeNonceDto } from './dto/handshake.dto';
import { HANDSHAKE_MESSAGES, LocalHandshakeService } from './local-handshake.service';
import { RemoteClockService } from './remote-clock.service';

type Req_ = { user?: { userId?: string; sid?: string | null; roles?: string[] } };

const ADMIN_ROLES = ['admin', 'super_admin'];

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

  private assertAdmin(req: Req_): void {
    const isAdmin = (req.user?.roles ?? []).some((r) => ADMIN_ROLES.includes(String(r).toLowerCase()));
    if (!req.user?.userId || !isAdmin) throw new ForbiddenException('Solo un administrador');
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
    const userId = this.userIdOf(req);
    // Go to lunch / Back to lunch: estrictos como el clock. Misma máquina + mismo usuario + socket activo,
    // verificados aquí (el nonce se consume) ANTES de mandar nada a la app.
    if (LUNCH_ACTIONS.includes(dto.action)) {
      if (!dto.nonce) {
        throw new HttpException(
          { statusCode: 409, code: 'HANDSHAKE_REQUIRED', message: HANDSHAKE_MESSAGES.HANDSHAKE_INVALID },
          409,
        );
      }
      const code = this.handshake.evaluate(userId, dto.nonce);
      if (code) throw new HttpException({ statusCode: 409, code, message: HANDSHAKE_MESSAGES[code] }, 409);
    }
    return this.service.request(userId, dto.external_employee_number, dto.action);
  }

  // ── Admin (force clock out) ───────────────────────────────────────────────────────────

  @Post('admin/lunch-back')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Admin: pide a la app del empleado en lunch que registre el regreso (con screenshot) antes de un force clock out',
    description: 'Siempre 200: { ok:false } si la app no está conectada, no responde o rechaza.',
  })
  adminLunchBack(@Req() req: Req_, @Body() dto: AdminEmployeeDto) {
    this.assertAdmin(req);
    return this.service.requestForcedLunchBack(dto.employee_number);
  }

  @Post('admin/force-screenshot')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Admin: pide a la app del empleado un screenshot para el CLOCK_OUT forzado',
    description: 'Siempre 200: { ok:false } si la app no está conectada, no responde o rechaza.',
  })
  adminForceScreenshot(@Req() req: Req_, @Body() dto: AdminScreenshotDto) {
    this.assertAdmin(req);
    return this.service.requestForcedScreenshot(dto.employee_number, dto.record_id);
  }

  @Post('admin/records-changed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Admin: avisa a la app del empleado que recargue sus registros (cierre de un admin)' })
  adminRecordsChanged(@Req() req: Req_, @Body() dto: AdminEmployeeDto) {
    this.assertAdmin(req);
    return this.service.notifyRecordsChanged(dto.employee_number);
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
