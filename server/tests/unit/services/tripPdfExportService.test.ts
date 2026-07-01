import { exportTripPdf } from '../../../src/services/tripPdfExportService';

import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildTripPdfHtmlMock,
  exportPdfPageMock,
  getTripSummaryMock,
  listCategoriesAsyncMock,
  listPlacesAsyncMock,
  placePhotoCacheGetAsyncMock,
  placePhotoCacheGetMock,
  placePhotoCacheServeObjectMock,
  putMediaBufferMock,
  chromiumLaunchMock,
} = vi.hoisted(() => {
  const fs = require('node:fs/promises') as typeof import('node:fs/promises');

  const page = {
    route: vi.fn(async () => {}),
    setContent: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
    emulateMedia: vi.fn(async () => {}),
    pdf: vi.fn(async ({ path: filePath }: { path: string }) => {
      await fs.mkdir(require('node:path').dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, Buffer.from('%PDF-1.4\n% Trippi test PDF\n'));
    }),
  };

  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };

  return {
    buildTripPdfHtmlMock: vi.fn(() => '<html><body>PDF</body></html>'),
    exportPdfPageMock: page,
    getTripSummaryMock: vi.fn(),
    listCategoriesAsyncMock: vi.fn(),
    listPlacesAsyncMock: vi.fn(),
    placePhotoCacheGetAsyncMock: vi.fn(),
    placePhotoCacheGetMock: vi.fn(),
    placePhotoCacheServeObjectMock: vi.fn(),
    putMediaBufferMock: vi.fn(),
    chromiumLaunchMock: vi.fn(async () => browser),
  };
});

vi.mock('@trippi/shared', () => ({ buildTripPdfHtml: buildTripPdfHtmlMock }));
vi.mock('@trippi/shared/i18n/en', () => ({ default: {} }));
vi.mock('playwright', () => ({ chromium: { launch: chromiumLaunchMock } }));

vi.mock('../../../src/services/perfTrace', () => ({
  createPerfTrace: () => ({
    measure: async (_name: string, fn: () => unknown) => fn(),
    measureSync: (_name: string, fn: () => unknown) => fn(),
    event: vi.fn(),
    finish: vi.fn(),
  }),
}));

vi.mock('../../../src/services/tripService', () => ({ getTripSummary: getTripSummaryMock }));
vi.mock('../../../src/services/placeService', () => ({ listPlacesAsync: listPlacesAsyncMock }));
vi.mock('../../../src/services/categoryService', () => ({ listCategoriesAsync: listCategoriesAsyncMock }));
vi.mock('../../../src/services/notifications', () => ({ getMcpSafeUrl: () => 'https://trippi.test' }));
vi.mock('../../../src/services/mediaStorage', () => ({
  getMediaConfig: () => ({ backend: 'local' }),
  putMediaBuffer: putMediaBufferMock,
}));
vi.mock('../../../src/services/placePhotoCache', () => ({
  get: placePhotoCacheGetMock,
  getAsync: placePhotoCacheGetAsyncMock,
  serveObject: placePhotoCacheServeObjectMock,
}));

const exportDir = path.join(process.cwd(), 'uploads/exports');

beforeEach(() => {
  vi.clearAllMocks();
  placePhotoCacheGetMock.mockImplementation(() => {
    throw new Error('sync place photo cache access should not be used by PDF export');
  });
  placePhotoCacheGetAsyncMock.mockResolvedValue({
    photoUrl: '/api/maps/place-photo/google-1/bytes',
    filePath: path.join(process.cwd(), 'uploads/photos/google/google-1.jpg'),
    attribution: 'Google',
  });
  placePhotoCacheServeObjectMock.mockImplementation(async () => ({
    stream: Readable.from([Buffer.from('fake jpeg bytes')]),
    contentType: 'image/jpeg',
    size: 15,
    etag: null,
  }));
  getTripSummaryMock.mockResolvedValue({
    trip: { id: 123, title: 'Async PDF Trip', cover_image: '/api/maps/place-photo/google-1/bytes' },
    days: [
      {
        id: 1,
        day_number: 1,
        title: 'Tokyo',
        date: '2026-07-08',
        assignments: [
          {
            id: 10,
            place: {
              id: 20,
              name: 'Senso-ji',
              image_url: '/api/maps/place-photo/google-1/bytes',
              google_place_id: 'google-1',
            },
          },
        ],
        notes: [],
      },
    ],
    accommodations: [],
    reservations: [],
  });
  listPlacesAsyncMock.mockResolvedValue([
    {
      id: 20,
      name: 'Senso-ji',
      image_url: '/api/maps/place-photo/google-1/bytes',
      google_place_id: 'google-1',
    },
  ]);
  listCategoriesAsyncMock.mockResolvedValue([]);
});

afterEach(async () => {
  await fs.rm(exportDir, { recursive: true, force: true });
});

describe('exportTripPdf', () => {
  it('uses async place-photo cache access under the MCP PDF path', async () => {
    const result = await exportTripPdf(123);

    expect(result.filename).toMatch(/async-pdf-trip.*\.pdf$/);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.url).toContain('https://trippi.test/uploads/exports/');
    expect(placePhotoCacheGetMock).not.toHaveBeenCalled();
    expect(placePhotoCacheGetAsyncMock).toHaveBeenCalledWith('google-1');
    expect(placePhotoCacheServeObjectMock).toHaveBeenCalledWith('google-1');
    expect(exportPdfPageMock.pdf).toHaveBeenCalled();

    const htmlInput = buildTripPdfHtmlMock.mock.calls[0][0];
    expect(JSON.stringify(htmlInput.days)).toContain('data:image/jpeg;base64');
    expect(JSON.stringify(htmlInput.places)).toContain('data:image/jpeg;base64');
  });
});
