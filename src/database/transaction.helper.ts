import { DataSource, EntityManager } from 'typeorm';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/**
 * Runs `fn` inside a SQLite IMMEDIATE transaction using TypeORM's query runner.
 *
 * We manually issue `BEGIN IMMEDIATE` to acquire a write lock upfront (avoiding
 * SQLITE_BUSY on concurrent writers), but we also set TypeORM's internal
 * transaction state flags so that nested TypeORM operations (e.g. manager.save())
 * use SAVEPOINT semantics instead of trying to open another transaction, which
 * would fail because SQLite is already inside BEGIN IMMEDIATE.
 */
export async function withImmediateTransaction<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const qr = dataSource.createQueryRunner();
  await qr.connect();

  let transactionStarted = false;
  try {
    await qr.query('BEGIN IMMEDIATE');
    transactionStarted = true;
    (qr as any).isTransactionActive = true;
    (qr as any).transactionDepth = 1;

    const result = await fn(qr.manager);
    await qr.query('COMMIT');
    return result;
  } catch (err) {
    if (transactionStarted) {
      try {
        await qr.query('ROLLBACK');
      } catch {
        // Ignore rollback errors — transaction may have been auto-rolled-back
      }
    }
    throw err;
  } finally {
    (qr as any).isTransactionActive = false;
    (qr as any).transactionDepth = 0;
    await qr.release();
  }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access */
