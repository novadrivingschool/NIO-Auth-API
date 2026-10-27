import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from './entities/user.entity';

/**
 * Bot de actividad (simulador de uso para probar el monitor del NIO): SOLO desarrollo/pruebas.
 *
 * ENCENDER `profile.dev_activity_bot` (true) exige las dos cosas:
 *  1) DEV_ACTIVITY_BOT=true en el entorno del API (apagado por defecto), y
 *  2) que quien edita tenga el rol super_admin.
 * APAGARLO (false) solo exige super_admin: apagar es el lado seguro y así un `true` ya guardado
 * nunca queda atascado si la variable se quita o el API se reinicia sin ella.
 * El control del frontend es solo UX: este es el candado real.
 */
export function isDevActivityBotEnabled(): boolean {
  return (
    String(process.env.DEV_ACTIVITY_BOT ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

/** Lanza 403/400 si el payload cambia `dev_activity_bot` sin cumplir las condiciones de arriba. */
export function assertDevActivityBotChangeAllowed(
  actorRoles: readonly string[] | undefined,
  profile?: { dev_activity_bot?: boolean | null } | null,
): void {
  const value = profile?.dev_activity_bot;
  if (value === undefined) return; // no lo toca: nada que validar

  // Solo `false` (apagar) se salta la variable de entorno; cualquier otro valor la exige.
  if (value !== false && !isDevActivityBotEnabled()) {
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
