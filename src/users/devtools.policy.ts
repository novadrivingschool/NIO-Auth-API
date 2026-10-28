import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from './entities/user.entity';

/**
 * DevTools de la app NIO (diagnóstico en tiempo real, producción y desarrollo).
 *
 * Cambiar `profile.devtools_enabled` (true o false) exige rol super_admin o admin y un valor
 * booleano. No depende de variables de entorno: debe poder usarse en producción. Abrir DevTools
 * expone el renderer del equipo del usuario (tokens de sesión, IPC), por eso no se permite a
 * employee/customer.
 * El control del frontend es solo UX: este es el candado real.
 */
export function assertDevtoolsChangeAllowed(
  actorRoles: readonly string[] | undefined,
  profile?: { devtools_enabled?: boolean | null } | null,
): void {
  const value = profile?.devtools_enabled;
  if (value === undefined) return; // no lo toca: nada que validar

  const allowed = actorRoles?.some(
    (r) => r === Role.SUPER_ADMIN || r === Role.ADMIN,
  );
  if (!allowed) {
    throw new ForbiddenException('Only admins can change devtools');
  }
  if (typeof value !== 'boolean') {
    throw new BadRequestException('devtools_enabled must be a boolean');
  }
}
