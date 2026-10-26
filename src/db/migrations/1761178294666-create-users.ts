import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUsers1761178294666 implements MigrationInterface {
    name = 'CreateUsers1761178294666'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_profiles" ADD "employee_number" character varying(16)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_profiles" DROP COLUMN "employee_number"`);
    }

}
