import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Horarios variable por FECHA.
 *
 * Antes un variable guardaba una plantilla por día de la semana; ahora cada
 * bloque lleva su fecha concreta (`date`), de modo que cada día del periodo
 * puede tener su propio horario. Los horarios fixed no cambian (date = NULL).
 *
 * Migra esquemas creados con la versión anterior de
 * 1790000000000-create-employee-schedules y convierte los variables que ya
 * existan: cada bloque semanal se expande a las fechas del periodo que caen en
 * ese día de la semana. Es idempotente: sobre un esquema ya actualizado no
 * cambia nada.
 */
export class EmployeeScheduleDaysByDate1790000000001
  implements MigrationInterface
{
  name = 'EmployeeScheduleDaysByDate1790000000001';

  public async up(q: QueryRunner): Promise<void> {
    // 1) El índice único por (horario, día) pasa a ser parcial (solo fixed).
    await q.query(
      `DROP INDEX IF EXISTS "UQ_employee_schedule_days_schedule_weekday"`,
    );

    // 2) Columna y reglas nuevas.
    await q.query(
      `ALTER TABLE "employee_schedule_days" ADD COLUMN IF NOT EXISTS "date" date`,
    );
    await q.query(
      `ALTER TABLE "employee_schedule_days" DROP CONSTRAINT IF EXISTS "CHK_employee_schedule_days_date_weekday"`,
    );
    await q.query(`
      ALTER TABLE "employee_schedule_days"
        ADD CONSTRAINT "CHK_employee_schedule_days_date_weekday"
        CHECK ("date" IS NULL OR "weekday" = EXTRACT(ISODOW FROM "date"))
    `);

    // 3) Un variable ya no está atado a lunes→domingo: periodo libre con fin
    //    obligatorio.
    await q.query(
      `ALTER TABLE "employee_schedules" DROP CONSTRAINT IF EXISTS "CHK_employee_schedules_variable_week"`,
    );
    await q.query(
      `ALTER TABLE "employee_schedules" DROP CONSTRAINT IF EXISTS "CHK_employee_schedules_variable_has_end"`,
    );
    await q.query(`
      ALTER TABLE "employee_schedules"
        ADD CONSTRAINT "CHK_employee_schedules_variable_has_end"
        CHECK ("type" <> 'variable' OR "valid_to" IS NOT NULL)
    `);

    // 4) Convierte los variables existentes (bloques por día de la semana) a
    //    bloques por fecha.
    await q.query(`
      INSERT INTO "employee_schedule_days"
        ("schedule_id", "weekday", "date", "start_time", "end_time", "lunch_start", "lunch_end")
      SELECT d."schedule_id", d."weekday", g::date,
             d."start_time", d."end_time", d."lunch_start", d."lunch_end"
      FROM "employee_schedule_days" d
      JOIN "employee_schedules" s ON s."id" = d."schedule_id"
      CROSS JOIN LATERAL generate_series(s."valid_from", s."valid_to", interval '1 day') g
      WHERE s."type" = 'variable'
        AND d."date" IS NULL
        AND EXTRACT(ISODOW FROM g) = d."weekday"
    `);
    await q.query(`
      DELETE FROM "employee_schedule_days" d
      USING "employee_schedules" s
      WHERE s."id" = d."schedule_id" AND s."type" = 'variable' AND d."date" IS NULL
    `);

    // 5) Unicidad: fixed por día de la semana, variable por fecha.
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_employee_schedule_days_schedule_weekday" ON "employee_schedule_days" ("schedule_id", "weekday") WHERE "date" IS NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_employee_schedule_days_schedule_date" ON "employee_schedule_days" ("schedule_id", "date") WHERE "date" IS NOT NULL`,
    );
  }

  /**
   * Vuelve al modelo por día de la semana. Con varias fechas del mismo día de
   * la semana en un variable solo se conserva la más temprana (se pierde el
   * detalle por fecha).
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP INDEX IF EXISTS "UQ_employee_schedule_days_schedule_date"`,
    );
    await q.query(
      `DROP INDEX IF EXISTS "UQ_employee_schedule_days_schedule_weekday"`,
    );
    await q.query(`
      DELETE FROM "employee_schedule_days" d
      USING "employee_schedule_days" e
      WHERE d."date" IS NOT NULL
        AND d."schedule_id" = e."schedule_id"
        AND d."weekday" = e."weekday"
        AND e."date" IS NOT NULL
        AND e."date" < d."date"
    `);
    await q.query(
      `ALTER TABLE "employee_schedule_days" DROP CONSTRAINT IF EXISTS "CHK_employee_schedule_days_date_weekday"`,
    );
    await q.query(
      `ALTER TABLE "employee_schedule_days" DROP COLUMN IF EXISTS "date"`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_employee_schedule_days_schedule_weekday" ON "employee_schedule_days" ("schedule_id", "weekday")`,
    );
  }
}
