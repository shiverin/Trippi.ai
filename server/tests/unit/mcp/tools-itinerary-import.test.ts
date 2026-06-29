/**
 * Unit tests for one-shot MCP itinerary imports.
 */
import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import { createUser, createTrip, createDay, createPlace } from '../../helpers/factories';
import { createMcpHarness, parseToolResult, type McpHarness } from '../../helpers/mcp-harness';
import { resetTestDb } from '../../helpers/test-db';

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: (placeId: number) => {
      const place: any = db
        .prepare(
          `SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
           FROM places p
           LEFT JOIN categories c ON p.category_id = c.id
           WHERE p.id = ?`,
        )
        .get(placeId);
      if (!place) return null;
      const tags = db
        .prepare('SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?')
        .all(placeId);
      return {
        ...place,
        category: place.category_id
          ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon }
          : null,
        tags,
      };
    },
    canAccessTrip: (tripId: any, userId: number) =>
      db
        .prepare(
          `SELECT t.id, t.user_id
           FROM trips t
           LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
           WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`,
        )
        .get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trippi-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }));
vi.mock('../../../src/websocket', () => ({ broadcast: broadcastMock }));

const { searchPlacesMock, getPlaceDetailsMock } = vi.hoisted(() => ({
  searchPlacesMock: vi.fn(),
  getPlaceDetailsMock: vi.fn(),
}));
vi.mock('../../../src/services/mapsService', () => ({
  searchPlaces: searchPlacesMock,
  getPlaceDetails: getPlaceDetailsMock,
}));

const { exportTripPdfMock } = vi.hoisted(() => ({ exportTripPdfMock: vi.fn() }));
vi.mock('../../../src/services/tripPdfExportService', () => ({ exportTripPdf: exportTripPdfMock }));

let searchCounter = 0;

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  broadcastMock.mockClear();
  searchPlacesMock.mockReset();
  getPlaceDetailsMock.mockReset();
  exportTripPdfMock.mockReset();
  searchCounter = 0;
  delete process.env.DEMO_MODE;

  searchPlacesMock.mockImplementation(async (_userId: number, query: string) => {
    searchCounter += 1;
    return {
      source: 'test',
      places: [
        {
          name: query.split(',')[0],
          address: `${query} address`,
          lat: 24 + searchCounter / 100,
          lng: 102 + searchCounter / 100,
          google_place_id: `google-${searchCounter}`,
          google_ftid: `ftid-${searchCounter}`,
          source: 'test',
        },
      ],
    };
  });
  exportTripPdfMock.mockResolvedValue({ filename: 'yunnan.pdf', url: 'https://trippi.test/yunnan.pdf', bytes: 1234 });
});

afterAll(() => {
  testDb.close();
});

async function withHarness(userId: number, fn: (h: McpHarness) => Promise<void>) {
  const h = await createMcpHarness({ userId, withResources: false });
  try {
    await fn(h);
  } finally {
    await h.cleanup();
  }
}

function yunnanTenDayPlan() {
  return [
    {
      day_number: 1,
      date: '2026-10-01',
      title: 'Kunming arrival',
      city: 'Kunming',
      activities: [
        {
          title: 'Green Lake Park walk',
          category: 'nature',
          start_time: '09:00',
          end_time: '10:30',
          duration_minutes: 90,
          location: { query: 'Green Lake Park' },
          notes: 'Gentle first-morning stroll.',
        },
        {
          title: 'Yuantong Temple',
          category: 'attraction',
          start_time: '11:00',
          location: { query: 'Yuantong Temple' },
        },
      ],
      accommodation: {
        title: 'Kunming city center hotel',
        location: { query: 'Kunming Nanping Pedestrian Street hotel' },
        check_in: '15:00',
        check_out: '11:00',
      },
    },
    {
      day_number: 2,
      date: '2026-10-02',
      title: 'Stone Forest',
      city: 'Kunming',
      activities: [
        {
          title: 'Stone Forest scenic area',
          category: 'nature',
          start_time: '08:30',
          location: { query: 'Stone Forest Scenic Area' },
        },
        {
          title: 'Yunnan Nationalities Village',
          category: 'attraction',
          start_time: '16:00',
          location: { query: 'Yunnan Nationalities Village' },
        },
      ],
    },
    {
      day_number: 3,
      date: '2026-10-03',
      title: 'Kunming food and market day',
      city: 'Kunming',
      activities: [
        {
          title: 'Jingxing Bird and Flower Market',
          category: 'shopping',
          start_time: '09:30',
          location: { query: 'Jingxing Bird and Flower Market' },
        },
        {
          title: 'Nanping Pedestrian Street dinner',
          category: 'restaurant',
          start_time: '18:30',
          location: { query: 'Nanping Pedestrian Street' },
        },
      ],
    },
    {
      day_number: 4,
      date: '2026-10-04',
      title: 'Transfer to Dali',
      city: 'Dali',
      activities: [
        {
          title: 'Dali Ancient City',
          category: 'attraction',
          start_time: '14:00',
          location: { query: 'Dali Ancient City' },
        },
        {
          title: 'Foreigner Street evening',
          category: 'restaurant',
          start_time: '19:00',
          location: { query: 'Foreigner Street Dali' },
        },
      ],
      accommodation: {
        title: 'Dali Old Town guesthouse',
        location: { query: 'Dali Old Town guesthouse' },
        check_in: '15:00',
        check_out: '11:00',
      },
    },
    {
      day_number: 5,
      date: '2026-10-05',
      title: 'Erhai and Xizhou',
      city: 'Dali',
      activities: [
        {
          title: 'Erhai Lake cycling',
          category: 'nature',
          start_time: '09:00',
          location: { query: 'Erhai Lake' },
        },
        {
          title: 'Xizhou Ancient Town',
          category: 'attraction',
          start_time: '14:00',
          location: { query: 'Xizhou Ancient Town' },
        },
      ],
    },
    {
      day_number: 6,
      date: '2026-10-06',
      title: 'Cangshan and Three Pagodas',
      city: 'Dali',
      activities: [
        {
          title: 'Cangshan Mountain cable car',
          category: 'nature',
          start_time: '09:00',
          location: { query: 'Cangshan Mountain cable car' },
        },
        {
          title: 'Three Pagodas of Chongsheng Temple',
          category: 'attraction',
          start_time: '15:00',
          location: { query: 'Three Pagodas of Chongsheng Temple' },
        },
      ],
    },
    {
      day_number: 7,
      date: '2026-10-07',
      title: 'Transfer to Lijiang',
      city: 'Lijiang',
      activities: [
        {
          title: 'Lijiang Old Town',
          category: 'attraction',
          start_time: '14:00',
          location: { query: 'Lijiang Old Town' },
        },
        {
          title: 'Black Dragon Pool',
          category: 'nature',
          start_time: '16:30',
          location: { query: 'Black Dragon Pool Lijiang' },
        },
      ],
      accommodation: {
        title: 'Lijiang Old Town boutique hotel',
        location: { query: 'Lijiang Old Town boutique hotel' },
        check_in: '15:00',
        check_out: '11:00',
      },
    },
    {
      day_number: 8,
      date: '2026-10-08',
      title: 'Jade Dragon Snow Mountain',
      city: 'Lijiang',
      activities: [
        {
          title: 'Jade Dragon Snow Mountain',
          category: 'nature',
          start_time: '08:00',
          location: { query: 'Jade Dragon Snow Mountain' },
        },
        {
          title: 'Blue Moon Valley',
          category: 'nature',
          start_time: '14:00',
          location: { query: 'Blue Moon Valley' },
        },
      ],
    },
    {
      day_number: 9,
      date: '2026-10-09',
      title: 'Villages around Lijiang',
      city: 'Lijiang',
      activities: [
        {
          title: 'Baisha Village',
          category: 'attraction',
          start_time: '09:30',
          location: { query: 'Baisha Village' },
        },
        {
          title: 'Shuhe Ancient Town',
          category: 'attraction',
          start_time: '14:30',
          location: { query: 'Shuhe Ancient Town' },
        },
      ],
    },
    {
      day_number: 10,
      date: '2026-10-10',
      title: 'Tiger Leaping Gorge or departure',
      city: 'Lijiang',
      activities: [
        {
          title: 'Tiger Leaping Gorge',
          category: 'nature',
          start_time: '08:00',
          location: { query: 'Tiger Leaping Gorge' },
        },
        {
          title: 'Lijiang Sanyi Airport',
          category: 'transport',
          start_time: '18:00',
          location: { query: 'Lijiang Sanyi Airport' },
        },
      ],
    },
  ];
}

describe('Tool: apply_itinerary_plan', () => {
  it('exposes a strict one-shot schema without raw coordinate fields', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (h) => {
      const result = await h.client.listTools();
      const applyTool = result.tools.find((tool) => tool.name === 'apply_itinerary_plan');

      expect(applyTool).toBeTruthy();
      expect(JSON.stringify(applyTool?.inputSchema)).toContain('"exportPdf"');
      expect(JSON.stringify(applyTool?.inputSchema)).toContain('"destination_context"');
      expect(JSON.stringify(applyTool?.inputSchema)).not.toContain('"lat":');
      expect(JSON.stringify(applyTool?.inputSchema)).not.toContain('"lng":');
    });
  });

  it('creates a 10-day Yunnan trip with geocoded places, assignments, accommodations, and optional PDF', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'new_trip', title: 'Yunnan Highlights', currency: 'CNY' },
          lang: 'en',
          destination_context: 'Yunnan, China',
          exportPdf: true,
          days: yunnanTenDayPlan(),
        },
      });

      const data = parseToolResult(result) as any;
      expect(data.success).toBe(true);
      expect(data.tripId).toBeGreaterThan(0);
      expect(data.counts).toMatchObject({
        placesCreated: 23,
        assignmentsCreated: 20,
        accommodationsCreated: 3,
        reservationsCreated: 3,
        locationsResolved: 23,
      });
      expect(data.pdf).toMatchObject({ filename: 'yunnan.pdf', contentType: 'application/pdf' });

      expect((testDb.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(1);
      expect(
        (
          testDb.prepare('SELECT COUNT(*) AS count FROM places WHERE lat IS NOT NULL AND lng IS NOT NULL').get() as {
            count: number;
          }
        ).count,
      ).toBe(23);
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM day_assignments').get() as { count: number }).count).toBe(
        20,
      );
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM day_notes').get() as { count: number }).count).toBe(0);
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM days').get() as { count: number }).count).toBe(10);

      const timed = testDb.prepare("SELECT assignment_time FROM day_assignments WHERE assignment_time = '09:00'").get();
      expect(timed).toBeTruthy();
      const importedPlace = testDb
        .prepare('SELECT mcp_import_batch_id FROM places WHERE name LIKE ? LIMIT 1')
        .get('Green Lake Park%') as { mcp_import_batch_id: string | null };
      expect(importedPlace.mcp_import_batch_id).toBe(data.batchId);
      expect(searchPlacesMock).toHaveBeenCalledWith(user.id, 'Green Lake Park, Kunming, Yunnan, China', 'en');
      expect(exportTripPdfMock).toHaveBeenCalledWith(data.tripId);
      expect(broadcastMock).toHaveBeenCalledWith(data.tripId, 'itinerary:imported', expect.any(Object));
    });
  });

  it('rejects raw coordinates in itinerary location payloads', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'new_trip', title: 'Coordinate Rejection Test' },
          days: [
            {
              day_number: 1,
              city: 'Dali',
              activities: [
                {
                  title: 'Dali Ancient City',
                  category: 'attraction',
                  start_time: '10:00',
                  location: { query: 'Dali Ancient City', lat: 25.691, lng: 100.159 },
                },
              ],
            },
          ],
        },
      });

      expect(result.isError).toBe(true);
      expect(searchPlacesMock).not.toHaveBeenCalled();
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(0);
    });
  });

  it('appends to an existing trip and geocodes supplied location queries', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id, { day_number: 1, title: 'Dali' });

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'existing_trip', tripId: trip.id, mode: 'append' },
          destination_context: 'Yunnan, China',
          days: [
            {
              day_number: 1,
              city: 'Dali',
              activities: [
                {
                  title: 'Dali Ancient City',
                  category: 'attraction',
                  start_time: '10:00',
                  location: { query: 'Dali Ancient City' },
                },
              ],
            },
          ],
        },
      });
      const data = parseToolResult(result) as any;
      expect(data.success).toBe(true);
      expect(searchPlacesMock).toHaveBeenCalledWith(user.id, 'Dali Ancient City, Yunnan, China', undefined);
      expect(
        (
          testDb.prepare('SELECT COUNT(*) AS count FROM day_assignments WHERE day_id = ?').get(day.id) as {
            count: number;
          }
        ).count,
      ).toBe(1);
      expect(testDb.prepare('SELECT title FROM days WHERE id = ?').get(day.id)).toMatchObject({ title: 'Dali' });
    });
  });

  it('rolls back the entire import when a required location cannot be resolved', async () => {
    const { user } = createUser(testDb);
    searchPlacesMock.mockImplementation(async (_userId: number, query: string) => ({
      source: 'test',
      places: query.includes('Missing') ? [] : [{ name: query, lat: 25.1, lng: 100.1 }],
    }));

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'new_trip', title: 'Broken Import' },
          days: [
            {
              day_number: 1,
              city: 'Lijiang',
              activities: [
                { title: 'Resolvable', location: { query: 'Lijiang Old Town' } },
                { title: 'Missing', location: { query: 'Missing Pin' } },
              ],
            },
          ],
        },
      });

      expect(result.isError).toBe(true);
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(0);
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM places').get() as { count: number }).count).toBe(0);
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM day_assignments').get() as { count: number }).count).toBe(
        0,
      );
    });
  });

  it('falls back to approximate destination pins when geocoding is rate-limited', async () => {
    const { user } = createUser(testDb);
    searchPlacesMock.mockRejectedValue(new Error('Nominatim API error: 429 Too Many Requests'));

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'new_trip', title: 'Rate Limited Yunnan', currency: 'CNY' },
          destination_context: 'Yunnan, China',
          exportPdf: true,
          days: [
            {
              day_number: 1,
              city: 'Kunming',
              activities: [
                { title: 'Green Lake Park', category: 'nature', location: { query: 'Green Lake Park' } },
                {
                  title: 'High-speed train to Dali',
                  category: 'transport',
                  location: { query: 'Kunming Railway Station' },
                },
              ],
            },
            {
              day_number: 2,
              city: 'Dali',
              activities: [
                { title: 'Dali Ancient City', category: 'attraction', location: { query: 'Dali Ancient City' } },
              ],
            },
          ],
        },
      });

      const data = parseToolResult(result) as any;
      expect(data.success).toBe(true);
      expect(data.pdf).toMatchObject({ filename: 'yunnan.pdf', contentType: 'application/pdf' });
      expect(data.warnings).toHaveLength(3);
      expect(data.warnings[0]).toContain('geocoding was rate-limited');
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(1);
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM places').get() as { count: number }).count).toBe(3);
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM day_assignments').get() as { count: number }).count).toBe(
        3,
      );
      expect(testDb.prepare("SELECT lat, lng FROM places WHERE name = 'Green Lake Park'").get()).toMatchObject({
        lat: 25.0389,
        lng: 102.7183,
      });
    });
  });

  it('retries simplified geocoding queries before failing an import', async () => {
    const { user } = createUser(testDb);
    searchPlacesMock.mockImplementation(async (_userId: number, query: string) => ({
      source: 'test',
      places:
        query === 'Stone Forest Kunming'
          ? [{ name: 'Stone Forest', address: 'Shilin, Kunming', lat: 24.8157, lng: 103.3246 }]
          : [],
    }));

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'new_trip', title: 'Yunnan Fallback Test' },
          days: [
            {
              day_number: 1,
              city: 'Kunming',
              activities: [
                {
                  title: 'Stone Forest',
                  location: { query: 'Stone Forest Scenic Area Kunming' },
                },
              ],
            },
          ],
        },
      });

      const data = parseToolResult(result) as any;
      expect(data.success).toBe(true);
      expect(searchPlacesMock).toHaveBeenCalledWith(user.id, 'Stone Forest Scenic Area Kunming', undefined);
      expect(searchPlacesMock).toHaveBeenCalledWith(user.id, 'Stone Forest Kunming', undefined);
      expect(testDb.prepare("SELECT lat, lng FROM places WHERE name = 'Stone Forest'").get()).toMatchObject({
        lat: 24.8157,
        lng: 103.3246,
      });
      expect((testDb.prepare('SELECT COUNT(*) AS count FROM day_assignments').get() as { count: number }).count).toBe(
        1,
      );
    });
  });

  it('replace_imported removes only previous MCP-imported itinerary content', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id, { day_number: 1 });

    await withHarness(user.id, async (h) => {
      await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'existing_trip', tripId: trip.id, mode: 'append' },
          days: [
            {
              day_number: 1,
              activities: [{ title: 'Imported Old Town', location: { query: 'Old Town' } }],
            },
          ],
        },
      });

      const userPlace = createPlace(testDb, trip.id, { name: 'User Saved Cafe', lat: 26.9, lng: 100.2 });
      testDb
        .prepare('INSERT INTO day_assignments (day_id, place_id, order_index, notes) VALUES (?, ?, ?, ?)')
        .run(day.id, userPlace.id, 99, 'manual');

      await h.client.callTool({
        name: 'apply_itinerary_plan',
        arguments: {
          target: { kind: 'existing_trip', tripId: trip.id, mode: 'replace_imported' },
          days: [
            {
              day_number: 1,
              activities: [{ title: 'Imported New Town', location: { query: 'New Town' } }],
            },
          ],
        },
      });

      expect(testDb.prepare("SELECT id FROM places WHERE name = 'Old Town'").get()).toBeUndefined();
      expect(testDb.prepare("SELECT id FROM places WHERE name = 'User Saved Cafe'").get()).toBeTruthy();
      expect(testDb.prepare("SELECT id FROM places WHERE name = 'New Town'").get()).toBeTruthy();
      expect(
        (
          testDb.prepare('SELECT COUNT(*) AS count FROM day_assignments WHERE day_id = ?').get(day.id) as {
            count: number;
          }
        ).count,
      ).toBe(2);
    });
  });
});
