import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function src(path: string): string {
  return join(process.cwd(), 'src', path);
}

describe('async DB access guardrails', () => {
  it('keeps the Oracle async adapter free of blocking bridge primitives', () => {
    const source = readFileSync(src('db/oracleAsyncAdapter.ts'), 'utf8');

    expect(source).not.toMatch(/\bAtomics\.wait\b/);
    expect(source).not.toMatch(/\bSharedArrayBuffer\b/);
    expect(source).not.toMatch(/\bworker_threads\b/);
  });

  it('keeps converted request auth/access entry points off the sync database module', () => {
    const convertedEntryPoints = [
      'middleware/auth.ts',
      'middleware/idempotency.ts',
      'middleware/mfaPolicy.ts',
      'middleware/tripAccess.ts',
      'services/tripAccess.ts',
      'websocket.ts',
      'mcp/index.ts',
      'mcp/resources.ts',
      'nest/auth/auth-public.controller.ts',
      'nest/auth/auth.controller.ts',
      'nest/auth/auth.service.ts',
      'nest/auth/cookie-auth.guard.ts',
      'nest/auth/jwt-auth.guard.ts',
      'nest/auth/optional-jwt.guard.ts',
      'nest/files/files-download.controller.ts',
      'nest/platform/platform.routes.ts',
      'nest/trips/trips.controller.ts',
      'nest/trips/trips.service.ts',
    ];

    const offenders = convertedEntryPoints.filter((file) => {
      const source = readFileSync(src(file), 'utf8');
      return /from ['"][^'"]*db\/database['"]/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
