import { DatabaseService } from './database.service';
import { Global, Module } from '@nestjs/common';

/**
 * Global so every migrated module can inject DatabaseService without re-importing.
 * Wraps the existing better-sqlite3 singleton (no new connection).
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
