// src/bootstrap/bootstrap.service.ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Role, User } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';
import { Repository } from 'typeorm';
//import { UsersService } from '@/users/users.service';
//import { User, Role } from '@/users/entities/user.entity';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
    private readonly logger = new Logger(BootstrapService.name);

    constructor(
        @InjectRepository(User) private readonly usersRepo: Repository<User>,
        private readonly usersService: UsersService,
        private readonly config: ConfigService,
    ) { }

    async onApplicationBootstrap() {
        const enabled = this.config.get<string>('ADMIN_BOOTSTRAP') === 'true';
        if (!enabled) return;

        const count = await this.usersRepo.count();
        if (count > 0) {
            this.logger.log('Usuarios existentes: omitiendo bootstrap de super admin');
            return;
        }

        const email = this.config.get<string>('ADMIN_EMAIL');
        const password = this.config.get<string>('ADMIN_PASSWORD');
        const roleFromEnv = (this.config.get<string>('ADMIN_ROLE') || 'admin').toLowerCase();

        if (!email || !password) {
            this.logger.error('ADMIN_EMAIL y ADMIN_PASSWORD son requeridos para bootstrap');
            return;
        }

        const chosenRole =
            (Object.values(Role) as string[]).includes(roleFromEnv as any)
                ? (roleFromEnv as Role)
                : Role.ADMIN;

        // --- Perfil desde .env (opcionales) ---
        const firstName = this.config.get<string>('OWNER_FIRST_NAME') || undefined;
        const lastName = this.config.get<string>('OWNER_LAST_NAME') || undefined;
        const birthdate = this.config.get<string>('OWNER_BIRTHDATE') || undefined; // YYYY-MM-DD
        const phone = this.config.get<string>('OWNER_PHONE') || undefined;
        const gender = this.config.get<string>('OWNER_GENDER') || undefined;
        const avatarUrl = this.config.get<string>('OWNER_AVATAR_URL') || undefined;

        let metadata: Record<string, any> | undefined = undefined;
        const rawMeta = this.config.get<string>('OWNER_METADATA');
        if (rawMeta) {
            try { metadata = JSON.parse(rawMeta); }
            catch { this.logger.warn('OWNER_METADATA no es JSON válido; se ignora'); }
        }

        try {
            const user = await this.usersService.create({
                email,
                password,
                roles: [chosenRole],
                isActive: true,
                profile: {
                    firstName, lastName, birthdate, phone, gender, avatarUrl, metadata,
                },
            } as any);

            this.logger.log(`Super admin creado: ${email} (role: ${chosenRole})`);
            this.logger.warn('⚠️ Desactiva ADMIN_BOOTSTRAP=true y rota la contraseña.');
        } catch (e: any) {
            this.logger.error('Error creando super admin: ' + e?.message);
        }
    }

}
