import { DatabaseService } from '../../../src/nest/database/database.service';
import { HealthController } from '../../../src/nest/health/health.controller';
import { HealthService } from '../../../src/nest/health/health.service';
import type { User } from '../../../src/types';

import { describe, it, expect, vi } from 'vitest';

const user = { id: 1, role: 'user', email: 'u@example.test' } as User;

function makeService(overrides: Partial<HealthService> = {}): HealthService {
  return {
    info: vi.fn().mockResolvedValue({ runtime: 'nestjs', diInjected: true, userCount: 0 }),
    ...overrides,
  } as unknown as HealthService;
}

describe('HealthController (foundation smoke endpoints under /api/_nest)', () => {
  it('GET /health merges ok:true with the service info', async () => {
    const svc = makeService({
      info: vi.fn().mockResolvedValue({ runtime: 'nestjs', diInjected: true, userCount: 7 }),
    });
    await expect(new HealthController(svc).getHealth()).resolves.toEqual({
      ok: true,
      runtime: 'nestjs',
      diInjected: true,
      userCount: 7,
    });
  });

  it('GET /me returns the authenticated user as-is', () => {
    const svc = makeService();
    expect(new HealthController(svc).me(user)).toBe(user);
  });

  it('POST /echo wraps the validated body', () => {
    const svc = makeService();
    expect(new HealthController(svc).echo({ name: 'Maurice' })).toEqual({
      youSent: { name: 'Maurice' },
    });
  });
});

describe('HealthService.info (shared SQLite connection proof)', () => {
  function makeDb(get: () => Promise<unknown>): DatabaseService {
    return { get: vi.fn(get) } as unknown as DatabaseService;
  }

  it('returns the real user count when the row resolves', async () => {
    const service = new HealthService(makeDb(async () => ({ n: 42 })));
    await expect(service.info()).resolves.toEqual({
      runtime: 'nestjs',
      diInjected: true,
      userCount: 42,
    });
  });

  it('falls back to null when the row is undefined', async () => {
    const service = new HealthService(makeDb(async () => undefined));
    await expect(service.info()).resolves.toMatchObject({ userCount: null });
  });

  it('falls back to null when the count column is null', async () => {
    const service = new HealthService(makeDb(async () => ({ n: null })));
    await expect(service.info()).resolves.toMatchObject({ userCount: null });
  });
});
