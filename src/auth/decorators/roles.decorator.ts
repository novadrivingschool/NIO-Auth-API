import { SetMetadata } from '@nestjs/common';
import { Role } from '../../users/entities/user.entity';

export const ROLES_KEY = 'roles';

/** Restringe una ruta o controlador a usuarios con alguno de estos roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
