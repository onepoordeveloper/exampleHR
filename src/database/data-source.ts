import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'better-sqlite3',
  database: process.env.DATABASE_PATH ?? './data/timeoff.sqlite',
  synchronize: false,
  logging: false,
  entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  prepareDatabase: (db: { pragma: (s: string) => void }) => {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  },
});
