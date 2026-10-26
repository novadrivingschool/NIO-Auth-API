import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Modo "vinculado" NIO + Activity Report por usuario.
 *
 * Si `activity_linked` es true, el clock manual de la app NIO se deshabilita y el Activity Report
 * solo permite Clock In / Clock Out con el socket de la app activo. Default false: nada cambia
 * para los usuarios existentes. Idempotente.
 */
export class AddActivityLinked1790000000003 implements MigrationInterface {
  name = 'AddActivityLinked1790000000003';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "activity_linked" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "activity_linked"`,
    );
  }
}
