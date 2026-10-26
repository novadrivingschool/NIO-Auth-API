import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auditoría de handshakes: cada vez que un admin pide una verificación a un
 * dispositivo se guarda la captura (keys de S3) y la actividad de ese momento.
 * Sin FKs a propósito: el registro debe sobrevivir aunque se elimine un usuario.
 */
export class CreateHandshakeCaptures1788000000000 implements MigrationInterface {
  name = 'CreateHandshakeCaptures1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "handshake_captures" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "target_user_id" uuid NOT NULL,
        "target_device_id" character varying(60),
        "requested_by" uuid NOT NULL,
        "employee_number" character varying(50),
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "responded_at" TIMESTAMP WITH TIME ZONE,
        "image_key" text,
        "thumb_key" text,
        "activity" jsonb,
        "error" text,
        CONSTRAINT "PK_handshake_captures_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_handshake_captures_target_requested"
      ON "handshake_captures" ("target_user_id", "requested_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_handshake_captures_target_requested"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "handshake_captures"`);
  }
}
