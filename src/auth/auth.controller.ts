// src/auth/auth.controller.ts
import { Controller, Post, Body, HttpCode, Req, Get, UnauthorizedException } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiNoContentResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokensDto } from './dto/tokens.dto';
import { Public } from './decorators/public.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';


@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }


  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login con email y password' })
  @ApiBody({
    type: LoginDto,
    examples: {
      admin: { summary: 'Login admin', value: { email: 'admin@example.com', password: 'StrongPass123' } },
      cliente: { summary: 'Login cliente', value: { email: 'cliente@example.com', password: 'StrongPass123' } },
    },
  })
  @ApiOkResponse({
    description: 'Login exitoso: retorna usuario y tokens',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas' })
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const ip: string = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.authService.login(dto, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Obtener nuevo access token usando refresh token' })
  @ApiBody({
    type: RefreshTokenDto,
    examples: {
      ejemplo: {
        summary: 'Refresh con token válido',
        value: { refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      },
    },
  })
  @ApiOkResponse({ description: 'Tokens rotados con éxito', type: TokensDto })
  @ApiUnauthorizedResponse({ description: 'Refresh token inválido o expirado' })
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokensDto> {
    return this.authService.refresh(dto.refreshToken, dto.deviceId);
  }

  // src/auth/auth.controller.ts
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cerrar sesión (invalida el refresh token)' })
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Logout exitoso' })
  @ApiUnauthorizedResponse({ description: 'Token inválido o ausente' })
  async logout(@Req() req: any): Promise<void> {
    // JwtStrategy.validate() debe retornar { userId, email, roles, sid? }
    const userId: string | undefined = req.user?.userId
    const sid: string | undefined = req.user?.sid
    await this.authService.logout(userId, sid)
  }

  // Endpoint para obtener los datos del usuario autenticado
  @Get('me')
  @ApiBearerAuth()  // Asegura que el token de autorización sea requerido
  @ApiOperation({ summary: 'Obtener los datos del usuario autenticado' })
  @ApiOkResponse({ description: 'Datos del usuario obtenidos correctamente' })
  @ApiUnauthorizedResponse({ description: 'Token inválido o expirado' })
  async getMe(@Req() req: any) {
    const userId = req.user?.userId; // Obtén el ID del usuario autenticado

    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    // Obtén el usuario con su perfil
    const user = await this.authService.getUserWithProfile(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;  // Devuelve el usuario con su perfil
  }
}
