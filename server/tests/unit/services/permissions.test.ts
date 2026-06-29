import {
  checkPermission,
  checkPermissionAsync,
  getPermissionLevel,
  getPermissionLevelAsync,
  savePermissions,
  savePermissionsAsync,
  invalidatePermissionsCache,
  PERMISSION_ACTIONS,
} from '../../../src/services/permissions';

import { describe, it, expect, vi } from 'vitest';

// Mutable rows array so individual tests can inject DB rows
const dbRows: { key: string; value: string }[] = [];

// Mock database — permissions module queries app_settings at runtime
vi.mock('../../../src/db/database', () => ({
  db: {
    prepare: () => ({
      all: () => dbRows, // no custom permissions → fall back to defaults
      run: vi.fn(),
      get: vi.fn(),
    }),
    transaction: (fn: () => void) => fn,
  },
}));

vi.mock('../../../src/db/asyncDatabase', () => ({
  asyncDb: {
    prepare: () => ({
      all: async () => dbRows,
      run: vi.fn(async () => ({ changes: 1, lastInsertRowid: 1 })),
      get: vi.fn(),
    }),
    transaction: (fn: () => void | Promise<void>) => async () => fn(),
  },
}));

describe('permissions', () => {
  describe('checkPermission — admin bypass', () => {
    it('admin always passes regardless of permission level', () => {
      for (const action of PERMISSION_ACTIONS) {
        expect(checkPermission(action.key, 'admin', 1, 1, false)).toBe(true);
        expect(checkPermission(action.key, 'admin', 99, 1, false)).toBe(true);
      }
    });
  });

  describe('checkPermission — everybody level', () => {
    it('trip_create (everybody) allows any authenticated user', () => {
      expect(checkPermission('trip_create', 'user', null, 42, false)).toBe(true);
    });
  });

  describe('checkPermission — trip_owner level', () => {
    const ownerId = 10;
    const memberId = 20;

    it('trip owner passes trip_owner check', () => {
      expect(checkPermission('trip_delete', 'user', ownerId, ownerId, false)).toBe(true);
    });

    it('member fails trip_owner check', () => {
      expect(checkPermission('trip_delete', 'user', ownerId, memberId, true)).toBe(false);
    });

    it('non-member non-owner fails trip_owner check', () => {
      expect(checkPermission('trip_delete', 'user', ownerId, memberId, false)).toBe(false);
    });
  });

  describe('checkPermission — trip_member level', () => {
    const ownerId = 10;
    const memberId = 20;
    const outsiderId = 30;

    it('trip owner passes trip_member check', () => {
      expect(checkPermission('day_edit', 'user', ownerId, ownerId, false)).toBe(true);
    });

    it('trip member passes trip_member check', () => {
      expect(checkPermission('day_edit', 'user', ownerId, memberId, true)).toBe(true);
    });

    it('outsider fails trip_member check', () => {
      expect(checkPermission('day_edit', 'user', ownerId, outsiderId, false)).toBe(false);
    });
  });

  describe('getPermissionLevel — defaults', () => {
    it('returns default level for known actions (no DB overrides)', () => {
      const defaults: Record<string, string> = {
        trip_create: 'everybody',
        trip_delete: 'trip_owner',
        day_edit: 'trip_member',
        budget_edit: 'trip_member',
      };
      for (const [key, expected] of Object.entries(defaults)) {
        expect(getPermissionLevel(key)).toBe(expected);
      }
    });

    it('returns trip_owner for unknown action key', () => {
      expect(getPermissionLevel('nonexistent_action')).toBe('trip_owner');
    });
  });

  describe('async variants', () => {
    it('getPermissionLevelAsync returns DB-backed overrides', async () => {
      dbRows.push({ key: 'perm_trip_delete', value: 'admin' });
      invalidatePermissionsCache();
      await expect(getPermissionLevelAsync('trip_delete')).resolves.toBe('admin');
      dbRows.length = 0;
      invalidatePermissionsCache();
    });

    it('checkPermissionAsync mirrors the sync role semantics', async () => {
      await expect(checkPermissionAsync('trip_delete', 'user', 10, 10, false)).resolves.toBe(true);
      await expect(checkPermissionAsync('trip_delete', 'user', 10, 20, true)).resolves.toBe(false);
    });

    it('savePermissionsAsync returns skipped invalid entries', async () => {
      const result = await savePermissionsAsync({ nonexistent_action: 'trip_member' });
      expect(result.skipped).toContain('nonexistent_action');
    });
  });

  describe('savePermissions — invalid action key is skipped', () => {
    it('returns skipped array containing invalid action key', () => {
      const result = savePermissions({ nonexistent_action: 'trip_member' });
      expect(result.skipped).toContain('nonexistent_action');
    });

    it('returns skipped array when level is not in allowedLevels for the action', () => {
      // trip_delete only allows ['admin', 'trip_owner'], so 'trip_member' is invalid
      const result = savePermissions({ trip_delete: 'trip_member' });
      expect(result.skipped).toContain('trip_delete');
    });
  });

  describe('checkPermission — default case', () => {
    it('returns false when permission level is an unrecognized value', () => {
      // Inject a DB row with an unknown level for trip_edit, then invalidate cache
      dbRows.push({ key: 'perm_trip_edit', value: 'unknown_level' });
      invalidatePermissionsCache();
      const result = checkPermission('trip_edit', 'user', 10, 10, false);
      // Clean up for subsequent tests
      dbRows.length = 0;
      invalidatePermissionsCache();
      expect(result).toBe(false);
    });
  });
});
