import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Horarios de empleados con vigencia e historial.
 *
 *  - employee_schedules: una "versión" de horario (fixed = recurrente con
 *    vigencia; variable = periodo concreto de un día a otro, con fin obligatorio).
 *  - employee_schedule_days: bloques de horario. fixed: por día ISO (1 = lunes …
 *    7 = domingo, date = NULL). variable: uno por fecha concreta (date) con su
 *    propio horario; weekday se guarda derivado de la fecha.
 *  - employee_schedule_revisions: bitácora de auditoría (sin FK a schedule_id
 *    para que el rastro de un horario borrado sobreviva).
 *
 * Los traslapes entre horarios de un mismo usuario los previene el servicio
 * dentro de una transacción con bloqueo del usuario (no se usa EXCLUDE con
 * btree_gist para no depender de permisos de extensiones en la BD gestionada).
 * `gen_random_uuid()` es nativa desde PostgreSQL 13.
 */
export class CreateEmployeeSchedules1790000000000 implements MigrationInterface {
  name = 'CreateEmployeeSchedules1790000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "employee_schedules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "type" character varying(16) NOT NULL,
        "valid_from" date NOT NULL,
        "valid_to" date,
        "notes" character varying(500),
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_employee_schedules_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_employee_schedules_type"
          CHECK ("type" IN ('fixed', 'variable')),
        CONSTRAINT "CHK_employee_schedules_range"
          CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
        CONSTRAINT "CHK_employee_schedules_variable_has_end"
          CHECK ("type" <> 'variable' OR "valid_to" IS NOT NULL)
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_employee_schedules_user_valid_from" ON "employee_schedules" ("user_id", "valid_from")`,
    );

    await q.query(`
      CREATE TABLE "employee_schedule_days" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "schedule_id" uuid NOT NULL,
        "weekday" smallint NOT NULL,
        "date" date,
        "start_time" time NOT NULL,
        "end_time" time NOT NULL,
        "lunch_start" time,
        "lunch_end" time,
        CONSTRAINT "PK_employee_schedule_days" PRIMARY KEY ("id"),
        CONSTRAINT "FK_employee_schedule_days_schedule" FOREIGN KEY ("schedule_id")
          REFERENCES "employee_schedules"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_employee_schedule_days_weekday"
          CHECK ("weekday" BETWEEN 1 AND 7),
        CONSTRAINT "CHK_employee_schedule_days_date_weekday"
          CHECK ("date" IS NULL OR "weekday" = EXTRACT(ISODOW FROM "date")),
        CONSTRAINT "CHK_employee_schedule_days_hours"
          CHECK ("end_time" > "start_time"),
        CONSTRAINT "CHK_employee_schedule_days_lunch_pair"
          CHECK (("lunch_start" IS NULL) = ("lunch_end" IS NULL)),
        CONSTRAINT "CHK_employee_schedule_days_lunch_inside"
          CHECK (
            "lunch_start" IS NULL
            OR ("lunch_end" > "lunch_start"
                AND "lunch_start" > "start_time"
                AND "lunch_end" < "end_time")
          )
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_employee_schedule_days_schedule_weekday" ON "employee_schedule_days" ("schedule_id", "weekday") WHERE "date" IS NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_employee_schedule_days_schedule_date" ON "employee_schedule_days" ("schedule_id", "date") WHERE "date" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE "employee_schedule_revisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "schedule_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "action" character varying(16) NOT NULL,
        "snapshot" jsonb NOT NULL,
        "changed_by" uuid,
        "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_schedule_revisions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_employee_schedule_revisions_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_employee_schedule_revisions_action"
          CHECK ("action" IN ('created', 'updated', 'closed', 'deleted'))
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_employee_schedule_revisions_user_changed_at" ON "employee_schedule_revisions" ("user_id", "changed_at")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "employee_schedule_revisions"`);
    await q.query(`DROP TABLE IF EXISTS "employee_schedule_days"`);
    await q.query(`DROP TABLE IF EXISTS "employee_schedules"`);
  }
}
