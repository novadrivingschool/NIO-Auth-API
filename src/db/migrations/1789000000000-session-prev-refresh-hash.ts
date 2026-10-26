import { MigrationInterface, QueryRunner } from 'typeorm';

/** Guarda el hash del refresh token anterior para recuperar clientes que perdieron la respuesta de un refresh. */
export class SessionPrevRefreshHash1789000000000 implements MigrationInterface {
  name = 'SessionPrevRefreshHash1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "prev_refresh_token_hash" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "prev_rotated_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "prev_rotated_at"`);
    await queryRunner.query(`ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "prev_refresh_token_hash"`);
  }
}
