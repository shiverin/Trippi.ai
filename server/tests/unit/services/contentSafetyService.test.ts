import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/asyncDatabase', () => ({
  asyncDb: {},
}));

import { screenTextForFamilySafety } from '../../../src/services/contentSafetyService';

afterEach(() => {
  delete process.env.TRIPPI_PUBLIC_SHARE_CONTENT_FILTER;
  delete process.env.TRIPPI_PUBLIC_SHARE_BLOCKLIST;
});

describe('contentSafetyService', () => {
  it('flags unsafe public-share text by category', () => {
    expect(screenTextForFamilySafety('trip title', 'Beach porn crawl')).toEqual([
      { field: 'trip title', category: 'adult' },
    ]);
    expect(screenTextForFamilySafety('trip description', 'Add a cocaine meetup stop.')).toEqual([
      { field: 'trip description', category: 'drugs' },
    ]);
  });

  it('does not flag harmless travel phrasing that shares a partial phrase', () => {
    expect(screenTextForFamilySafety('trip note', 'Remember to gas the rental car before returning it.')).toEqual([]);
    expect(screenTextForFamilySafety('city', 'Visit Goreme for the balloons.')).toEqual([]);
  });

  it('supports environment opt-out and custom blocklist terms', () => {
    process.env.TRIPPI_PUBLIC_SHARE_CONTENT_FILTER = 'false';
    expect(screenTextForFamilySafety('trip title', 'Beach porn crawl')).toEqual([]);

    process.env.TRIPPI_PUBLIC_SHARE_CONTENT_FILTER = 'true';
    process.env.TRIPPI_PUBLIC_SHARE_BLOCKLIST = 'private-term';
    expect(screenTextForFamilySafety('trip title', 'A private-term itinerary')).toEqual([
      { field: 'trip title', category: 'adult' },
    ]);
  });
});
