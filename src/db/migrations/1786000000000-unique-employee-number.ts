import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice único parcial sobre user_profiles.employee_number.
 *
 * Necesario porque `POST /auth/login/web` resuelve al usuario por
 * employee_number. Sin unicidad, dos perfiles con el mismo número harían que el
 * login autentique a una persona arbitraria de las dos.
 *
 * Es parcial (WHERE employee_number IS NOT NULL) porque la columna es nullable
 * y en Postgres varios NULL no colisionan en un UNIQUE normal, pero dejarlo
 * explícito documenta la intención y evita sorpresas.
 *
 * Si la migración falla por duplicados preexistentes, localízalos con:
 *   SELECT employee_number, COUNT(*)
 *   FROM user_profiles
 *   WHERE employee_number IS NOT NULL
 *   GROUP BY 1 HAVING COUNT(*) > 1;
 */
export class UniqueEmployeeNumber1786000000000 implements MigrationInterface {
  name = 'UniqueEmployeeNumber1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: Array<{ employee_number: string; count: string }> =
      await queryRunner.query(`
        SELECT employee_number, COUNT(*)::text AS count
        FROM user_profiles
        WHERE employee_number IS NOT NULL
        GROUP BY employee_number
        HAVING COUNT(*) > 1
      `);

    if (duplicates.length > 0) {
      const detail = duplicates
        .map((d) => `${d.employee_number} (x${d.count})`)
        .join(', ');
      throw new Error(
        `No se puede crear el índice único: hay employee_number duplicados en user_profiles → ${detail}. ` +
          `Resuélvelos manualmente antes de correr esta migración.`,
      );
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_profiles_employee_number"
      ON "user_profiles" ("employee_number")
      WHERE "employee_number" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_user_profiles_employee_number"`,
    );
  }
}
