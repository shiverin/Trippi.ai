import { DatabaseService } from '../database/database.service';
import { Injectable } from '@nestjs/common';

/**
 * Smoke service proving NestJS DI works under the chosen runtime AND that the
 * injected DatabaseService talks to the configured async DB provider.
 */
@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  async info() {
    const row = await this.database.get<{ n: number }>('SELECT COUNT(*) AS n FROM users');
    return {
      runtime: 'nestjs',
      diInjected: true,
      // Proof the DB provider works: real row count from the configured DB.
      userCount: row?.n ?? null,
    };
  }
}
