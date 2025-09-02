import {
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { TokensDto } from './dto/tokens.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserDto } from './dto/user.dto';

type JwtPayload = {
    sub: string;          // user id
    email: string;
    roles: string[];
};

function normalizeEmail(email: string) {
    return String(email).trim().toLowerCase();
}

@Injectable()
export class AuthService {
    private readonly accessTtl: string;
    private readonly refreshTtl: string;
    private readonly accessSecret: string;
    private readonly refreshSecret: string;

    constructor(
        private readonly users: UsersService,
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
    ) {
        // .env (con defaults sensatos)
        this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
        this.refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
        this.accessSecret = this.config.get<string>('JWT_ACCESS_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? 'access_secret';
        this.refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? 'refresh_secret';
    }

    /* async login(dto: LoginDto): Promise<TokensDto> {
        const email = normalizeEmail(dto.email);
        const user = await this.users.findByEmail(email);
        if (!user) throw new UnauthorizedException('Invalid credentials');

        const ok = await bcrypt.compare(dto.password, user.passwordHash);
        if (!ok) throw new UnauthorizedException('Invalid credentials');

        const tokens = await this.signTokens({
            sub: user.id,
            email: user.email,
            roles: user.roles,
        });

        // Guarda hash del refresh (rotación segura)
        await this.users.updateRefreshToken(user.id, tokens.refreshToken);
        return tokens;
    } */

    // auth.service.ts (fragmento)
    async login(dto: LoginDto): Promise<AuthResponseDto> {
        const email = normalizeEmail(dto.email);
        // Trae el user con su perfil si lo tienes
        const user = await this.users.findByEmail(email);
        if (!user) throw new UnauthorizedException('Invalid credentials');

        const ok = await bcrypt.compare(dto.password, user.passwordHash);
        if (!ok) throw new UnauthorizedException('Invalid credentials');

        const tokens = await this.signTokens({
            sub: user.id,
            email: user.email,
            roles: user.roles,
        });

        await this.users.updateRefreshToken(user.id, tokens.refreshToken);

        return {
            user: this.toUserDto(user),
            tokens,
        };
    }

    // Mapea entidad -> DTO seguro (sin passwordHash)
    private toUserDto(u: any): UserDto {
        return {
            id: u.id,
            email: u.email,
            roles: u.roles,
            isActive: u.isActive,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
            firstName: u.profile?.firstName,
            lastName: u.profile?.lastName,
            avatarUrl: u.profile?.avatarUrl,
        };
    }


    async refresh(refreshToken: string): Promise<TokensDto> {
        if (!refreshToken) throw new UnauthorizedException('Missing refresh token');

        // 1) Verifica firma y exp del refresh
        let payload: JwtPayload;
        try {
            payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
                secret: this.refreshSecret,
            });
        } catch {
            throw new UnauthorizedException('Invalid refresh token');
        }

        // 2) Usuario debe existir
        const user = await this.users.findOne(payload.sub);
        if (!user) throw new UnauthorizedException('Invalid refresh token');

        // 3) Debe coincidir con el hash guardado
        if (!user.refreshTokenHash) {
            throw new UnauthorizedException('Refresh token not found');
        }
        const match = await bcrypt.compare(refreshToken, user.refreshTokenHash);
        if (!match) throw new UnauthorizedException('Invalid refresh token');

        // 4) Genera nuevos tokens y rota hash
        const tokens = await this.signTokens({
            sub: user.id,
            email: user.email,
            roles: user.roles,
        });
        await this.users.updateRefreshToken(user.id, tokens.refreshToken);

        return tokens;
        // (opcional: invalidar el refresh anterior guardando un "family id" o lista, fuera de scope)
    }

    async logout(userId: string): Promise<void> {
        await this.users.updateRefreshToken(userId, null);
    }

    // Temporal para que compile si aún no usas JwtGuard en el controller:
    /* async logoutPlaceholder(): Promise<void> {
        return;
    } */

    // ------------ helpers ------------
    private async signTokens(payload: JwtPayload): Promise<TokensDto> {
        const [accessToken, refreshToken] = await Promise.all([
            this.jwt.signAsync(payload, {
                secret: this.accessSecret,
                expiresIn: this.accessTtl,
            }),
            this.jwt.signAsync(payload, {
                secret: this.refreshSecret,
                expiresIn: this.refreshTtl,
            }),
        ]);

        return { accessToken, refreshToken };
    }

}
