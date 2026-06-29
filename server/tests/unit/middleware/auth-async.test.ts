import { verifyJwtAndLoadUser } from '../../../src/middleware/auth';

import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  let resolveUser: (value: unknown) => void = () => {};
  const userPromise = new Promise<unknown>((resolve) => {
    resolveUser = resolve;
  });
  return {
    prepare: vi.fn(() => ({
      get: vi.fn(() => userPromise),
    })),
    resolveUser,
  };
});

vi.mock('../../../src/config', () => ({ JWT_SECRET: 'test-secret' }));
vi.mock('../../../src/db/asyncDatabase', () => ({
  asyncDb: {
    prepare: dbMock.prepare,
  },
}));
vi.mock('../../../src/services/auditLog', () => ({ logWarn: vi.fn() }));

describe('verifyJwtAndLoadUser async DB behavior', () => {
  it('yields the event loop while waiting for a slow DB lookup', async () => {
    const token = jwt.sign({ id: 7, pv: 0 }, 'test-secret', { algorithm: 'HS256' });
    let resolved = false;

    const authPromise = verifyJwtAndLoadUser(token).then((user) => {
      resolved = true;
      return user;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolved).toBe(false);
    expect(dbMock.prepare).toHaveBeenCalledWith(
      'SELECT id, username, email, role, password_version FROM users WHERE id = ?',
    );

    dbMock.resolveUser({
      id: 7,
      username: 'leo',
      email: 'leo@example.com',
      role: 'user',
      password_version: 0,
    });

    await expect(authPromise).resolves.toEqual({
      id: 7,
      username: 'leo',
      email: 'leo@example.com',
      role: 'user',
    });
  });
});
