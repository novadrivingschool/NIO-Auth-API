import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../users/entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Autoriza por rol. Se aplica DESPUÉS del JwtAuthGuard global, que es quien
 * puebla `req.user` (`{ userId, roles }`). Sin `@Roles()` deja pasar.
 *
 * Los roles salen del access token, así que un cambio de rol se refleja al
 * expirar el token vigente.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as
      | { roles?: Role[] }
      | undefined;

    if (!user?.roles?.some((role) => required.includes(role))) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
