import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS leave_balances (
        id                   TEXT    PRIMARY KEY,
        employee_id          TEXT    NOT NULL REFERENCES employees(id),
        location_id          TEXT    NOT NULL REFERENCES locations(id),
        leave_type           TEXT    NOT NULL DEFAULT 'VACATION',
        hcm_balance          REAL    NOT NULL DEFAULT 0,
        pending_days         REAL    NOT NULL DEFAULT 0,
        version              INTEGER NOT NULL DEFAULT 1,
        hcm_last_synced_at   TEXT,
        created_at           TEXT    DEFAULT (datetime('now')),
        updated_at           TEXT    DEFAULT (datetime('now')),
        UNIQUE (employee_id, location_id, leave_type)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS time_off_requests (
        id                TEXT    PRIMARY KEY,
        employee_id       TEXT    NOT NULL REFERENCES employees(id),
        location_id       TEXT    NOT NULL REFERENCES locations(id),
        leave_type        TEXT    NOT NULL DEFAULT 'VACATION',
        start_date        TEXT    NOT NULL,
        end_date          TEXT    NOT NULL,
        days              REAL    NOT NULL,
        status            TEXT    NOT NULL DEFAULT 'PENDING',
        notes             TEXT,
        hcm_reference_id  TEXT,
        hcm_submitted_at  TEXT,
        idempotency_key   TEXT    UNIQUE,
        created_at        TEXT    DEFAULT (datetime('now')),
        updated_at        TEXT    DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS balance_audit_logs (
        id               TEXT  PRIMARY KEY,
        employee_id      TEXT  NOT NULL,
        location_id      TEXT  NOT NULL,
        leave_type       TEXT  NOT NULL,
        source           TEXT  NOT NULL,
        prev_hcm_balance REAL,
        new_hcm_balance  REAL,
        prev_pending     REAL,
        new_pending      REAL,
        reference_id     TEXT,
        created_at       TEXT  DEFAULT (datetime('now'))
      )
    `);

    // Indexes
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tor_emp_status ON time_off_requests(employee_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tor_balance_key ON time_off_requests(employee_id, location_id, leave_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_audit_ref ON balance_audit_logs(reference_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_audit_created ON balance_audit_logs(created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS balance_audit_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS time_off_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS leave_balances`);
    await queryRunner.query(`DROP TABLE IF EXISTS locations`);
    await queryRunner.query(`DROP TABLE IF EXISTS employees`);
  }
}
