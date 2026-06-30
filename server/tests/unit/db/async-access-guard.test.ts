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
      'mcp/oauthProvider.ts',
      'mcp/resources.ts',
      'mcp/tools/_shared.ts',
      'mcp/tools/budget.ts',
      'mcp/tools/days.ts',
      'mcp/tools/notifications.ts',
      'mcp/tools/packing.ts',
      'mcp/tools/places.ts',
      'nest/auth/auth-public.controller.ts',
      'nest/auth/auth.controller.ts',
      'nest/auth/auth.service.ts',
      'nest/auth/cookie-auth.guard.ts',
      'nest/auth/jwt-auth.guard.ts',
      'nest/auth/optional-jwt.guard.ts',
      'nest/admin/admin.controller.ts',
      'nest/admin/admin.service.ts',
      'nest/notifications/notifications.controller.ts',
      'nest/notifications/notifications.service.ts',
      'nest/oauth/oauth-api.controller.ts',
      'nest/oauth/oauth-public.controller.ts',
      'nest/oauth/oauth.service.ts',
      'nest/settings/settings.controller.ts',
      'nest/settings/settings.service.ts',
      'nest/system-notices/system-notices.controller.ts',
      'nest/system-notices/system-notices.service.ts',
      'nest/files/files-download.controller.ts',
      'nest/addons/addons.service.ts',
      'nest/categories/categories.controller.ts',
      'nest/categories/categories.service.ts',
      'nest/common/idempotency.interceptor.ts',
      'nest/database/database.service.ts',
      'nest/decisions/decisions.controller.ts',
      'nest/decisions/decisions.service.ts',
      'nest/health/health.service.ts',
      'nest/maps/maps.service.ts',
      'nest/platform/platform.routes.ts',
      'nest/tags/tags.controller.ts',
      'nest/tags/tags.service.ts',
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
