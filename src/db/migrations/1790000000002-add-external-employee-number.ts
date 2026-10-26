import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Número de empleado EXTERNO (app de RR.HH.) en el perfil.
 *
 * Es independiente de `employee_number` (el del NIO, autogenerado, que usa el
 * login y la asistencia). Opcional; único sin distinguir mayúsculas cuando
 * existe. Idempotente.
 */
export class AddExternalEmployeeNumber1790000000002
  implements MigrationInterface
{
  name = 'AddExternalEmployeeNumber1790000000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "external_employee_number" character varying(50)`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_profiles_external_employee_number" ON "user_profiles" (UPPER("external_employee_number")) WHERE "external_employee_number" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP INDEX IF EXISTS "UQ_user_profiles_external_employee_number"`,
    );
    await q.query(
      `ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "external_employee_number"`,
    );
  }
}
