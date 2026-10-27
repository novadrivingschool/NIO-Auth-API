import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bot de actividad SOLO para desarrollo/pruebas, por usuario.
 *
 * Si `dev_activity_bot` es true, la app NIO (corriendo sin empaquetar) muestra el simulador de uso
 * del equipo para ese usuario. Solo lo cambia un super_admin y solo con DEV_ACTIVITY_BOT=true en
 * el entorno del API. Default false: nada cambia para los usuarios existentes. Idempotente.
 */
export class AddDevActivityBot1790000000004 implements MigrationInterface {
  name = 'AddDevActivityBot1790000000004';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "dev_activity_bot" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "dev_activity_bot"`,
    );
  }
}
