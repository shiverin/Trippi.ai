import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

import { SettingsController } from '../../../src/nest/settings/settings.controller';
import type { SettingsService } from '../../../src/nest/settings/settings.service';
import type { User } from '../../../src/types';

const user = { id: 1, role: 'user', email: 'u@example.test' } as User;

function svc(o: Partial<SettingsService> = {}): SettingsService {
  return { getUserSettings: vi.fn(), upsertSetting: vi.fn(), bulkUpsertSettings: vi.fn(), ...o } as unknown as SettingsService;
}

async function thrown(fn: () => unknown | Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try { await fn(); } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected throw');
}

beforeEach(() => vi.clearAllMocks());

describe('SettingsController', () => {
  it('GET / returns the settings', async () => {
    await expect(new SettingsController(svc({ getUserSettings: vi.fn().mockResolvedValue({ theme: 'dark' }) } as Partial<SettingsService>)).list(user)).resolves.toEqual({ settings: { theme: 'dark' } });
  });

  it('PUT / 400 without a key', async () => {
    await expect(thrown(() => new SettingsController(svc()).upsert(user, {}))).resolves.toEqual({ status: 400, body: { error: 'Key is required' } });
  });

  it('PUT / no-ops on the masked sentinel without writing', async () => {
    const upsertSetting = vi.fn();
    const c = new SettingsController(svc({ upsertSetting } as Partial<SettingsService>));
    await expect(c.upsert(user, { key: 'immich_api_key', value: '••••••••' })).resolves.toEqual({ success: true, key: 'immich_api_key', unchanged: true });
    expect(upsertSetting).not.toHaveBeenCalled();
  });

  it('PUT / writes a real value', async () => {
    const upsertSetting = vi.fn().mockResolvedValue(undefined);
    const c = new SettingsController(svc({ upsertSetting } as Partial<SettingsService>));
    await expect(c.upsert(user, { key: 'theme', value: 'dark' })).resolves.toEqual({ success: true, key: 'theme', value: 'dark' });
    expect(upsertSetting).toHaveBeenCalledWith(1, 'theme', 'dark');
  });

  it('POST /bulk 400 without an object, 500 on a write error, else returns the count', async () => {
    await expect(thrown(() => new SettingsController(svc()).bulk(user, {}))).resolves.toEqual({ status: 400, body: { error: 'Settings object is required' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(thrown(() => new SettingsController(svc({ bulkUpsertSettings: vi.fn().mockRejectedValue(new Error('db')) } as Partial<SettingsService>)).bulk(user, { settings: { a: 1 } }))).resolves.toEqual({ status: 500, body: { error: 'Error saving settings' } });
    await expect(new SettingsController(svc({ bulkUpsertSettings: vi.fn().mockResolvedValue(3) } as Partial<SettingsService>)).bulk(user, { settings: { a: 1, b: 2, c: 3 } })).resolves.toEqual({ success: true, updated: 3 });
  });
});
