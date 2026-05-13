import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { AppConfig } from '../config/configuration';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<AppConfig>) => {
        const isTest = cfg.get('nodeEnv') === 'test';
        const baseOptions = {
          type: 'better-sqlite3' as const,
          entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
          prepareDatabase: (db: { pragma: (s: string) => void }) => {
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            db.pragma('busy_timeout = 5000');
          },
        };
        if (isTest) {
          return {
            ...baseOptions,
            database: ':memory:',
            synchronize: true,
            dropSchema: true,
          };
        }
        return {
          ...baseOptions,
          database: cfg.get<string>('databasePath')!,
          synchronize: false,
          migrationsRun: true,
          migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
        };
      },
    }),
  ],
})
export class DatabaseModule {}
