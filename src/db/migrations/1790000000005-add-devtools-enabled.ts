import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switch por usuario para abrir la ventana de DevTools en la app NIO (producción y desarrollo).
 *
 * Si `devtools_enabled` es true, la app NIO de ese usuario abre DevTools (ventana separada) en
 * tiempo real; al apagarlo se cierra. Solo lo cambian super_admin y admin. Default false: nada cambia
 * para los usuarios existentes. Idempotente.
 */
export class AddDevtoolsEnabled1790000000005 implements MigrationInterface {
  name = 'AddDevtoolsEnabled1790000000005';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "devtools_enabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "devtools_enabled"`,
    );
  }
}
