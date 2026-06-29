import { AddonsService } from '../../../src/nest/addons/addons.service';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Four prepare(...).all() reads (addons, photo_providers, fields, app_settings).
// A single shared statement is reused, so .all() is fed result sets in call order.
const { asyncDbMock } = vi.hoisted(() => {
  const stmt = { get: vi.fn(), all: vi.fn(async () => []), run: vi.fn() };
  return { asyncDbMock: { prepare: vi.fn(() => stmt), _stmt: stmt } };
});
vi.mock('../../../src/db/asyncDatabase', () => ({ asyncDb: asyncDbMock }));

const { getPhotoProviderConfig } = vi.hoisted(() => ({ getPhotoProviderConfig: vi.fn(() => ({})) }));
vi.mock('../../../src/services/memories/helpersService', () => ({ getPhotoProviderConfig }));

function svc() {
  return new AddonsService();
}

// Feed the four reads in order: addons, providers, fields, settings.
function feedReads(addons: unknown[], providers: unknown[], fields: unknown[], settings: unknown[] = []) {
  asyncDbMock._stmt.all
    .mockResolvedValueOnce(addons)
    .mockResolvedValueOnce(providers)
    .mockResolvedValueOnce(fields)
    .mockResolvedValueOnce(settings);
}

beforeEach(() => {
  vi.clearAllMocks();
  asyncDbMock._stmt.all.mockResolvedValue([]);
  getPhotoProviderConfig.mockReturnValue({});
});

describe('AddonsService.list', () => {
  it('returns the collab features and the bag-tracking flag from app settings', async () => {
    feedReads(
      [],
      [],
      [],
      [
        { key: 'bag_tracking_enabled', value: 'true' },
        { key: 'collab_chat_enabled', value: 'false' },
        { key: 'collab_notes_enabled', value: 'true' },
        { key: 'collab_polls_enabled', value: 'false' },
        { key: 'collab_whatsnext_enabled', value: 'true' },
      ],
    );

    const res = await svc().list();
    expect(res.collabFeatures).toEqual({ chat: false, notes: true, polls: false, whatsnext: true });
    expect(res.bagTracking).toBe(true);
    expect(res.addons).toEqual([]);
  });

  it('coerces the addon enabled column to a boolean (both 1 and 0)', async () => {
    feedReads(
      [
        { id: 'atlas', name: 'Atlas', type: 'page', icon: 'globe', enabled: 1 },
        { id: 'vacay', name: 'Vacay', type: 'page', icon: 'sun', enabled: 0 },
      ],
      [],
      [],
    );

    const res = await svc().list();
    expect(res.addons).toEqual([
      { id: 'atlas', name: 'Atlas', type: 'page', icon: 'globe', enabled: true },
      { id: 'vacay', name: 'Vacay', type: 'page', icon: 'sun', enabled: false },
    ]);
  });

  it('maps a photo provider with no fields to an empty fields array (the || [] fallback)', async () => {
    feedReads([], [{ id: 'immich', name: 'Immich', icon: 'image', enabled: 1, sort_order: 0 }], []);
    getPhotoProviderConfig.mockReturnValue({ baseUrl: 'http://x' });

    const res = await svc().list();
    expect(res.addons).toEqual([
      {
        id: 'immich',
        name: 'Immich',
        type: 'photo_provider',
        icon: 'image',
        enabled: true,
        config: { baseUrl: 'http://x' },
        fields: [],
      },
    ]);
    expect(getPhotoProviderConfig).toHaveBeenCalledWith('immich');
  });

  it('coerces a disabled photo provider enabled flag to false', async () => {
    feedReads([], [{ id: 'synology', name: 'Synology', icon: 'image', enabled: 0, sort_order: 1 }], []);

    const res = await svc().list();
    expect((res.addons[0] as { enabled: boolean }).enabled).toBe(false);
  });

  it('groups multiple fields under their provider and keeps insertion order', async () => {
    feedReads(
      [],
      [{ id: 'immich', name: 'Immich', icon: 'image', enabled: 1, sort_order: 0 }],
      [
        {
          provider_id: 'immich',
          field_key: 'url',
          label: 'URL',
          input_type: 'text',
          placeholder: 'https://',
          hint: 'Base URL',
          required: 1,
          secret: 0,
          settings_key: 'immich_url',
          payload_key: 'url',
          sort_order: 0,
        },
        // Second field for the SAME provider exercises the `get(...) || []` truthy branch.
        {
          provider_id: 'immich',
          field_key: 'token',
          label: 'Token',
          input_type: 'password',
          placeholder: null,
          hint: null,
          required: 0,
          secret: 1,
          settings_key: null,
          payload_key: null,
          sort_order: 1,
        },
      ],
    );

    const res = await svc().list();
    const provider = res.addons[0] as { fields: Array<Record<string, unknown>> };
    expect(provider.fields).toEqual([
      {
        key: 'url',
        label: 'URL',
        input_type: 'text',
        placeholder: 'https://',
        hint: 'Base URL',
        required: true,
        secret: false,
        settings_key: 'immich_url',
        payload_key: 'url',
        sort_order: 0,
      },
      {
        key: 'token',
        label: 'Token',
        input_type: 'password',
        placeholder: '',
        hint: null,
        required: false,
        secret: true,
        settings_key: null,
        payload_key: null,
        sort_order: 1,
      },
    ]);
  });

  it('falls back placeholder→"", hint→null, settings/payload keys→null when columns are missing/empty', async () => {
    feedReads(
      [],
      [{ id: 'p', name: 'P', icon: 'i', enabled: 1, sort_order: 0 }],
      [
        {
          provider_id: 'p',
          field_key: 'k',
          label: 'L',
          input_type: 'text',
          // placeholder/hint/settings_key/payload_key omitted entirely (undefined)
          required: 0,
          secret: 0,
          sort_order: 0,
        },
      ],
    );

    const res = await svc().list();
    const field = (res.addons[0] as { fields: Array<Record<string, unknown>> }).fields[0];
    expect(field).toMatchObject({
      placeholder: '',
      hint: null,
      settings_key: null,
      payload_key: null,
    });
  });

  it('keeps fields belonging to other providers out of a provider with none of its own', async () => {
    // A field exists, but for a DIFFERENT provider than the one returned — exercises
    // the `fieldsByProvider.get(p.id) || []` fallback while the map is non-empty.
    feedReads(
      [],
      [{ id: 'has-none', name: 'X', icon: 'i', enabled: 1, sort_order: 0 }],
      [
        {
          provider_id: 'other',
          field_key: 'k',
          label: 'L',
          input_type: 'text',
          required: 0,
          secret: 0,
          sort_order: 0,
        },
      ],
    );

    const res = await svc().list();
    expect((res.addons[0] as { fields: unknown[] }).fields).toEqual([]);
  });

  it('concatenates regular addons before the photo providers', async () => {
    feedReads(
      [{ id: 'atlas', name: 'Atlas', type: 'page', icon: 'globe', enabled: 1 }],
      [{ id: 'immich', name: 'Immich', icon: 'image', enabled: 1, sort_order: 0 }],
      [],
    );

    const res = await svc().list();
    expect(res.addons.map((a) => (a as { id: string }).id)).toEqual(['atlas', 'immich']);
    expect((res.addons[1] as { type: string }).type).toBe('photo_provider');
  });
});
