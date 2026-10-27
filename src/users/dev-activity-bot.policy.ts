import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from './entities/user.entity';

/**
 * Bot de actividad (simulador de uso para probar el monitor del NIO): SOLO desarrollo/pruebas.
 *
 * Cambiar `profile.dev_activity_bot` exige las dos cosas:
 *  1) DEV_ACTIVITY_BOT=true en el entorno del API (apagado por defecto), y
 *  2) que quien edita tenga el rol super_admin.
 * El control del frontend es solo UX: este es el candado real.
 */
export function isDevActivityBotEnabled(): boolean {
  return (
    String(process.env.DEV_ACTIVITY_BOT ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

/** Lanza 403 si el payload toca `dev_activity_bot` sin cumplir las dos condiciones. */
export function assertDevActivityBotChangeAllowed(
  actorRoles: readonly string[] | undefined,
  profile?: { dev_activity_bot?: boolean | null } | null,
): void {
  const value = profile?.dev_activity_bot;
  if (value === undefined) return; // no lo toca: nada que validar

  if (!isDevActivityBotEnabled()) {
    throw new ForbiddenException(
      'The dev activity bot is disabled in this environment',
    );
  }
  if (!actorRoles?.includes(Role.SUPER_ADMIN)) {
    throw new ForbiddenException(
      'Only super admins can change the dev activity bot',
    );
  }
  if (typeof value !== 'boolean') {
    throw new BadRequestException('dev_activity_bot must be a boolean');
  }
}
