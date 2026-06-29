import { asyncDb, canAccessTripAsync } from '../db/asyncDatabase';
import type { Journey, JourneyEntry, JourneyPhoto, JourneyContributor } from '../types';
import { broadcastToUser } from '../websocket';
import {
  getOrCreateTrippiPhotoAsync,
  getOrCreateLocalTrippiPhotoAsync,
  setTrippiPhotoProviderAsync,
  deleteTrippiPhotoIfOrphanAsync,
} from './memories/photoResolverService';

function ts(): number {
  return Date.now();
}

// Per-entry photo view: join journey_entry_photos → journey_photos (gallery) → trippi_photos.
// id = gp.id (gallery photo id) — used by clients for linkPhoto/updatePhoto/unlink/delete.
const JP_SELECT = `
  gp.id, jep.entry_id, gp.photo_id, gp.caption, jep.sort_order, gp.shared, gp.created_at,
  tp.provider, tp.asset_id, tp.owner_id, tp.file_path, tp.thumbnail_path, tp.width, tp.height
`;
const JP_JOIN = `journey_entry_photos jep
  JOIN journey_photos gp ON gp.id  = jep.journey_photo_id
  JOIN trippi_photos    tp ON tp.id  = gp.photo_id`;

// Per-journey gallery view: journey_photos → trippi_photos (no entry context).
const GALLERY_SELECT = `
  gp.id, gp.journey_id, gp.photo_id, gp.caption, gp.shared, gp.sort_order, gp.created_at,
  tp.provider, tp.asset_id, tp.owner_id, tp.file_path, tp.thumbnail_path, tp.width, tp.height
`;
const GALLERY_JOIN = 'journey_photos gp JOIN trippi_photos tp ON tp.id = gp.photo_id';

async function broadcastJourneyEvent(
  journeyId: number,
  event: string,
  data: Record<string, unknown>,
  excludeSocketId?: string | number,
): Promise<void> {
  const contributors = await asyncDb
    .prepare('SELECT user_id FROM journey_contributors WHERE journey_id = ?')
    .all<{ user_id: number }>(journeyId);
  const owner = await asyncDb.prepare('SELECT user_id FROM journeys WHERE id = ?').get<{ user_id: number }>(journeyId);

  const userIds = new Set(contributors.map((c) => c.user_id));
  if (owner) userIds.add(owner.user_id);

  for (const uid of userIds) {
    broadcastToUser(uid, { type: event, journeyId, ...data }, excludeSocketId);
  }
}

// ── Access control ───────────────────────────────────────────────────────

export async function canAccessJourney(journeyId: number, userId: number): Promise<Journey | null> {
  const own = await asyncDb
    .prepare('SELECT * FROM journeys WHERE id = ? AND user_id = ?')
    .get<Journey>(journeyId, userId);
  if (own) return own;
  const contrib = await asyncDb
    .prepare('SELECT 1 FROM journey_contributors WHERE journey_id = ? AND user_id = ?')
    .get(journeyId, userId);
  if (contrib) return (await asyncDb.prepare('SELECT * FROM journeys WHERE id = ?').get<Journey>(journeyId)) || null;
  return null;
}

export async function isOwner(journeyId: number, userId: number): Promise<boolean> {
  return !!(await asyncDb.prepare('SELECT 1 FROM journeys WHERE id = ? AND user_id = ?').get(journeyId, userId));
}

export async function canEdit(journeyId: number, userId: number): Promise<boolean> {
  if (await isOwner(journeyId, userId)) return true;
  const c = await asyncDb
    .prepare('SELECT role FROM journey_contributors WHERE journey_id = ? AND user_id = ?')
    .get<{ role: string }>(journeyId, userId);
  return c?.role === 'editor' || c?.role === 'owner';
}

// ── Journey CRUD ─────────────────────────────────────────────────────────

export async function listJourneys(userId: number) {
  return asyncDb
    .prepare(
      `
    SELECT j.*,
      (SELECT COUNT(*) FROM journey_entries je WHERE je.journey_id = j.id AND je.type != 'skeleton') as entry_count,
      (SELECT COUNT(*) FROM journey_photos jp WHERE jp.journey_id = j.id) as photo_count,
      (SELECT COUNT(DISTINCT je3.location_name) FROM journey_entries je3 WHERE je3.journey_id = j.id AND je3.location_name IS NOT NULL AND je3.location_name != '') as place_count,
      (SELECT MIN(t.start_date) FROM journey_trips jt JOIN trips t ON jt.trip_id = t.id WHERE jt.journey_id = j.id) as trip_date_min,
      (SELECT MAX(t.end_date) FROM journey_trips jt JOIN trips t ON jt.trip_id = t.id WHERE jt.journey_id = j.id) as trip_date_max
    FROM journeys j
    LEFT JOIN journey_contributors jc ON j.id = jc.journey_id AND jc.user_id = ?
    WHERE j.user_id = ? OR jc.user_id = ?
    ORDER BY j.updated_at DESC
  `,
    )
    .all<
      Journey & {
        entry_count: number;
        photo_count: number;
        place_count: number;
        trip_date_min: string | null;
        trip_date_max: string | null;
      }
    >(userId, userId, userId);
}

export async function createJourney(
  userId: number,
  data: {
    title: string;
    subtitle?: string;
    trip_ids?: number[];
  },
): Promise<Journey> {
  const now = ts();
  const res = await asyncDb
    .prepare(
      `
    INSERT INTO journeys (user_id, title, subtitle, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `,
    )
    .run(userId, data.title, data.subtitle || null, now, now);

  const journeyId = Number(res.lastInsertRowid);

  // add owner as contributor
  await asyncDb
    .prepare('INSERT INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
    .run(journeyId, userId, 'owner', now);

  // link trips and sync skeleton entries
  if (data.trip_ids?.length) {
    for (const tripId of data.trip_ids) {
      await addTripToJourney(journeyId, tripId, userId);
    }

    // inherit cover image from first selected trip
    const firstTrip = await asyncDb
      .prepare('SELECT cover_image FROM trips WHERE id = ?')
      .get<{ cover_image: string | null }>(data.trip_ids[0]);
    if (firstTrip?.cover_image) {
      // trip stores full path (/uploads/covers/x.jpg), journey stores relative (covers/x.jpg)
      const relativePath = firstTrip.cover_image.replace(/^\/uploads\//, '');
      await asyncDb.prepare('UPDATE journeys SET cover_image = ? WHERE id = ?').run(relativePath, journeyId);
    }
  }

  return (await asyncDb.prepare('SELECT * FROM journeys WHERE id = ?').get<Journey>(journeyId))!;
}

export async function getJourneyFull(journeyId: number, userId: number) {
  const journey = await canAccessJourney(journeyId, userId);
  if (!journey) return null;

  const entries = await asyncDb
    .prepare('SELECT * FROM journey_entries WHERE journey_id = ? ORDER BY entry_date ASC, sort_order ASC, id ASC')
    .all<JourneyEntry>(journeyId);

  const photos = await asyncDb
    .prepare(
      `SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE jep.entry_id IN (SELECT id FROM journey_entries WHERE journey_id = ?) ORDER BY jep.sort_order ASC`,
    )
    .all<JourneyPhoto>(journeyId);

  // group photos by entry
  const photosByEntry: Record<number, JourneyPhoto[]> = {};
  for (const p of photos) {
    (photosByEntry[p.entry_id] ||= []).push(p);
  }

  const gallery = await asyncDb
    .prepare(
      `SELECT ${GALLERY_SELECT} FROM ${GALLERY_JOIN} WHERE gp.journey_id = ? ORDER BY gp.sort_order ASC, gp.id ASC`,
    )
    .all(journeyId);

  const sourceTripIds = [...new Set(entries.map((e) => e.source_trip_id).filter(Boolean))] as number[];
  const sourceTripRows =
    sourceTripIds.length > 0
      ? await asyncDb
          .prepare(`SELECT id, title FROM trips WHERE id IN (${sourceTripIds.map(() => '?').join(',')})`)
          .all<{ id: number; title: string }>(...sourceTripIds)
      : [];
  const sourceTripNames = new Map(sourceTripRows.map((t) => [t.id, t.title]));

  const enrichedEntries = entries.map((e) => ({
    ...e,
    tags: e.tags ? JSON.parse(e.tags) : [],
    pros_cons: e.pros_cons ? JSON.parse(e.pros_cons) : null,
    photos: photosByEntry[e.id] || [],
    source_trip_name: e.source_trip_id ? sourceTripNames.get(e.source_trip_id) || null : null,
  }));

  // linked trips
  const trips = await asyncDb
    .prepare(
      `
    SELECT jt.trip_id, jt.added_at, t.title, t.start_date, t.end_date, t.cover_image, t.currency,
      (SELECT COUNT(*) FROM places WHERE trip_id = t.id) as place_count
    FROM journey_trips jt JOIN trips t ON jt.trip_id = t.id
    WHERE jt.journey_id = ? ORDER BY t.start_date ASC
  `,
    )
    .all(journeyId);

  // contributors
  const contributorsRaw = await asyncDb
    .prepare(
      `
    SELECT jc.journey_id, jc.user_id, jc.role, jc.added_at, u.username, u.avatar
    FROM journey_contributors jc JOIN users u ON jc.user_id = u.id
    WHERE jc.journey_id = ? ORDER BY jc.added_at
  `,
    )
    .all<any>(journeyId);
  const contributors = contributorsRaw.map((c) => ({
    ...c,
    avatar_url: c.avatar ? `/uploads/avatars/${c.avatar}` : null,
  }));

  // stats
  const entryCount = entries.filter((e) => e.type === 'entry').length;
  const photoCount = (gallery as any[]).length;
  const places = [...new Set(entries.map((e) => e.location_name).filter(Boolean))];

  const userPrefs = await asyncDb
    .prepare('SELECT hide_skeletons FROM journey_contributors WHERE journey_id = ? AND user_id = ?')
    .get<{ hide_skeletons: number }>(journeyId, userId);

  // Determine the viewer's role on this journey so the UI can gate edit/settings
  // actions. 'owner' = creator, 'editor' | 'viewer' = from journey_contributors.
  const journeyRow = journey as unknown as { user_id?: number };
  let myRole: 'owner' | 'editor' | 'viewer' | null;
  if (journeyRow.user_id === userId) {
    myRole = 'owner';
  } else {
    const contribRow = await asyncDb
      .prepare('SELECT role FROM journey_contributors WHERE journey_id = ? AND user_id = ?')
      .get<{ role: 'editor' | 'viewer' }>(journeyId, userId);
    myRole = contribRow?.role ?? null;
  }

  return {
    ...journey,
    entries: enrichedEntries,
    gallery,
    trips,
    contributors,
    stats: { entries: entryCount, photos: photoCount, places: places.length },
    hide_skeletons: !!userPrefs?.hide_skeletons,
    my_role: myRole,
  };
}

export async function updateJourney(
  journeyId: number,
  userId: number,
  data: Partial<{
    title: string;
    subtitle: string;
    cover_gradient: string;
    cover_image: string;
    status: string;
  }>,
): Promise<Journey | null> {
  // Journey-level settings (title, cover, status) are owner-only — editors
  // may only edit entries and photos, not reshape the journey itself.
  if (!(await isOwner(journeyId, userId))) return null;

  const ALLOWED_STATUSES = ['draft', 'active', 'completed', 'archived'];
  const allowed = ['title', 'subtitle', 'cover_gradient', 'cover_image', 'status'];
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && allowed.includes(key)) {
      if (key === 'status' && !ALLOWED_STATUSES.includes(val as string)) continue;
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0)
    return (await asyncDb.prepare('SELECT * FROM journeys WHERE id = ?').get<Journey>(journeyId))!;

  fields.push('updated_at = ?');
  values.push(ts());
  values.push(journeyId);
  await asyncDb.prepare(`UPDATE journeys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return (await asyncDb.prepare('SELECT * FROM journeys WHERE id = ?').get<Journey>(journeyId))!;
}

export async function updateJourneyPreferences(journeyId: number, userId: number, data: { hide_skeletons?: boolean }) {
  if (!(await canAccessJourney(journeyId, userId))) return null;
  if (data.hide_skeletons !== undefined) {
    await asyncDb
      .prepare('UPDATE journey_contributors SET hide_skeletons = ? WHERE journey_id = ? AND user_id = ?')
      .run(data.hide_skeletons ? 1 : 0, journeyId, userId);
  }
  const row = await asyncDb
    .prepare('SELECT hide_skeletons FROM journey_contributors WHERE journey_id = ? AND user_id = ?')
    .get<{ hide_skeletons: number }>(journeyId, userId);
  return { hide_skeletons: !!row?.hide_skeletons };
}

export async function deleteJourney(journeyId: number, userId: number): Promise<boolean> {
  if (!(await isOwner(journeyId, userId))) return false;
  await asyncDb.prepare('DELETE FROM journeys WHERE id = ?').run(journeyId);
  return true;
}

// ── Trip management ──────────────────────────────────────────────────────

export async function addTripToJourney(journeyId: number, tripId: number, userId: number): Promise<boolean> {
  // Only attach a trip the caller can actually access — otherwise a journey
  // owner could pull an arbitrary trip's places + photos into their journey
  // (cross-tenant leak). Mirrors the trip-access gate every other trip-scoped
  // path enforces.
  if (!(await canAccessTripAsync(tripId, userId))) return false;
  const now = ts();
  try {
    await asyncDb
      .prepare('INSERT OR IGNORE INTO journey_trips (journey_id, trip_id, added_at) VALUES (?, ?, ?)')
      .run(journeyId, tripId, now);
  } catch {
    return false;
  }

  // sync skeleton entries for all places in this trip
  await syncTripPlaces(journeyId, tripId, userId);
  // import existing trip photos (Immich/Synology) with sharing settings
  await syncTripPhotos(journeyId, tripId);
  await broadcastJourneyEvent(journeyId, 'journey:trip:synced', { tripId });
  return true;
}

export async function removeTripFromJourney(journeyId: number, tripId: number, userId: number): Promise<boolean> {
  if (!(await isOwner(journeyId, userId))) return false;

  // remove skeleton entries that haven't been filled in
  await asyncDb
    .prepare(
      `
    DELETE FROM journey_entries
    WHERE journey_id = ? AND source_trip_id = ? AND type = 'skeleton'
  `,
    )
    .run(journeyId, tripId);

  // detach filled entries from this trip
  await asyncDb
    .prepare(
      `
    UPDATE journey_entries SET source_trip_id = NULL, source_place_id = NULL
    WHERE journey_id = ? AND source_trip_id = ? AND type != 'skeleton'
  `,
    )
    .run(journeyId, tripId);

  await asyncDb.prepare('DELETE FROM journey_trips WHERE journey_id = ? AND trip_id = ?').run(journeyId, tripId);
  return true;
}

// ── Sync engine ──────────────────────────────────────────────────────────

export async function syncTripPlaces(journeyId: number, tripId: number, authorId: number): Promise<void> {
  const places = await asyncDb
    .prepare(
      `
    SELECT p.*, da.day_id, d.date as day_date, da.assignment_time, da.assignment_end_time, d.day_number
    FROM places p
    INNER JOIN day_assignments da ON da.place_id = p.id
    INNER JOIN days d ON da.day_id = d.id
    WHERE p.trip_id = ?
    ORDER BY d.day_number ASC, da.order_index ASC
  `,
    )
    .all<any>(tripId);

  const now = ts();
  const existing = await asyncDb
    .prepare('SELECT source_place_id FROM journey_entries WHERE journey_id = ? AND source_trip_id = ?')
    .all<{ source_place_id: number }>(journeyId, tripId);
  const existingPlaceIds = new Set(existing.map((e) => e.source_place_id));

  // Track next sort_order per date so synced skeletons get unique, sequential positions.
  const dateMaxOrder = new Map<string, number>();
  const maxRows = await asyncDb
    .prepare(
      'SELECT entry_date, COALESCE(MAX(sort_order), -1) AS m FROM journey_entries WHERE journey_id = ? GROUP BY entry_date',
    )
    .all<{ entry_date: string; m: number }>(journeyId);
  for (const row of maxRows) dateMaxOrder.set(row.entry_date, row.m);

  for (const place of places) {
    if (existingPlaceIds.has(place.id)) continue;
    existingPlaceIds.add(place.id);

    const entryDate = place.day_date || new Date().toISOString().split('T')[0];
    const entryTime = place.assignment_time || place.place_time || null;
    const nextOrder = (dateMaxOrder.get(entryDate) ?? -1) + 1;
    dateMaxOrder.set(entryDate, nextOrder);

    await asyncDb
      .prepare(
        `
      INSERT INTO journey_entries (journey_id, source_trip_id, source_place_id, author_id, type, title, entry_date, entry_time, location_name, location_lat, location_lng, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'skeleton', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        journeyId,
        tripId,
        place.id,
        authorId,
        place.name,
        entryDate,
        entryTime,
        place.address || place.name,
        place.lat || null,
        place.lng || null,
        nextOrder,
        now,
        now,
      );
  }
}

// import trip_photos into journey gallery when a trip is linked
async function syncTripPhotos(journeyId: number, tripId: number): Promise<void> {
  const tripPhotos = await asyncDb
    .prepare('SELECT tp.photo_id, tp.shared FROM trip_photos tp WHERE tp.trip_id = ?')
    .all<{ photo_id: number; shared: number }>(tripId);
  if (!tripPhotos.length) return;

  const now = ts();
  const maxOrderRow = await asyncDb
    .prepare('SELECT MAX(sort_order) as m FROM journey_photos WHERE journey_id = ?')
    .get<{ m: number | null }>(journeyId);
  let nextOrder = (maxOrderRow?.m ?? -1) + 1;

  for (const tp of tripPhotos) {
    await asyncDb
      .prepare(
        `
      INSERT OR IGNORE INTO journey_photos (journey_id, photo_id, shared, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(journeyId, tp.photo_id, tp.shared, nextOrder++, now);
  }
}

// called when a trip place is created
export async function onPlaceCreated(tripId: number, placeId: number): Promise<void> {
  const links = await asyncDb
    .prepare('SELECT journey_id FROM journey_trips WHERE trip_id = ?')
    .all<{ journey_id: number }>(tripId);
  if (!links.length) return;

  const place = await asyncDb
    .prepare(
      `
    SELECT p.*, da.day_id, d.date as day_date, da.assignment_time, d.day_number
    FROM places p
    INNER JOIN day_assignments da ON da.place_id = p.id
    INNER JOIN days d ON da.day_id = d.id
    WHERE p.id = ?
  `,
    )
    .get<any>(placeId);
  if (!place) return; // not assigned to a day yet — skip

  const now = ts();
  for (const link of links) {
    const already = await asyncDb
      .prepare('SELECT 1 FROM journey_entries WHERE journey_id = ? AND source_place_id = ?')
      .get(link.journey_id, placeId);
    if (already) continue;

    const journey = await asyncDb
      .prepare('SELECT user_id FROM journeys WHERE id = ?')
      .get<{ user_id: number }>(link.journey_id);
    if (!journey) continue;
    const entryDate = place.day_date;
    const maxOrder = await asyncDb
      .prepare('SELECT MAX(sort_order) AS m FROM journey_entries WHERE journey_id = ? AND entry_date = ?')
      .get<{ m: number | null }>(link.journey_id, entryDate);
    const nextOrder = (maxOrder?.m ?? -1) + 1;

    await asyncDb
      .prepare(
        `
      INSERT INTO journey_entries (journey_id, source_trip_id, source_place_id, author_id, type, title, entry_date, entry_time, location_name, location_lat, location_lng, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'skeleton', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        link.journey_id,
        tripId,
        placeId,
        journey.user_id,
        place.name,
        entryDate,
        place.assignment_time || place.place_time || null,
        place.address || place.name,
        place.lat || null,
        place.lng || null,
        nextOrder,
        now,
        now,
      );
  }
}

// called when a trip place is updated
export async function onPlaceUpdated(placeId: number): Promise<void> {
  const entries = await asyncDb
    .prepare('SELECT * FROM journey_entries WHERE source_place_id = ?')
    .all<JourneyEntry>(placeId);
  if (!entries.length) return;

  const place = await asyncDb
    .prepare(
      `
    SELECT p.*, da.day_id, d.date as day_date, da.assignment_time, d.day_number
    FROM places p
    LEFT JOIN day_assignments da ON da.place_id = p.id
    LEFT JOIN days d ON da.day_id = d.id
    WHERE p.id = ?
  `,
    )
    .get<any>(placeId);
  if (!place) return;

  const now = ts();
  for (const entry of entries) {
    if (entry.type === 'skeleton') {
      // update everything on skeletons
      await asyncDb
        .prepare(
          `
        UPDATE journey_entries SET title = ?, entry_date = ?, entry_time = ?, location_name = ?, location_lat = ?, location_lng = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(
          place.name,
          place.day_date || entry.entry_date,
          place.assignment_time || place.place_time || entry.entry_time,
          place.address || place.name,
          place.lat || null,
          place.lng || null,
          now,
          entry.id,
        );
    } else {
      // for filled entries, only update location silently
      await asyncDb
        .prepare(
          `
        UPDATE journey_entries SET location_name = ?, location_lat = ?, location_lng = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(place.address || place.name, place.lat || null, place.lng || null, now, entry.id);
    }
  }
}

// called when a trip place is deleted
export async function onPlaceDeleted(placeId: number): Promise<void> {
  const entries = await asyncDb
    .prepare('SELECT * FROM journey_entries WHERE source_place_id = ?')
    .all<JourneyEntry>(placeId);

  for (const entry of entries) {
    if (entry.type === 'skeleton') {
      // no content: just delete
      const hasPhotos = await asyncDb.prepare('SELECT 1 FROM journey_entry_photos WHERE entry_id = ?').get(entry.id);
      if (!hasPhotos && !entry.story) {
        await asyncDb.prepare('DELETE FROM journey_entries WHERE id = ?').run(entry.id);
        continue;
      }
    }
    // entry has content: keep it, detach, add note
    const note = '\n\n> _Note: the original trip place was removed from the trip plan_';
    const newStory = (entry.story || '') + note;
    await asyncDb
      .prepare(
        'UPDATE journey_entries SET source_place_id = NULL, source_trip_id = NULL, type = ?, story = ?, updated_at = ? WHERE id = ?',
      )
      .run(entry.type === 'skeleton' ? 'entry' : entry.type, newStory, ts(), entry.id);
  }
}

// ── Entries ──────────────────────────────────────────────────────────────

export async function listEntries(journeyId: number, userId: number) {
  if (!(await canAccessJourney(journeyId, userId))) return null;

  const entries = await asyncDb
    .prepare('SELECT * FROM journey_entries WHERE journey_id = ? ORDER BY entry_date ASC, sort_order ASC, id ASC')
    .all<JourneyEntry>(journeyId);

  const photos = await asyncDb
    .prepare(
      `SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE jep.entry_id IN (SELECT id FROM journey_entries WHERE journey_id = ?) ORDER BY jep.sort_order ASC`,
    )
    .all<JourneyPhoto>(journeyId);

  const photosByEntry: Record<number, JourneyPhoto[]> = {};
  for (const p of photos) {
    (photosByEntry[p.entry_id] ||= []).push(p);
  }

  const sourceTripIds = [...new Set(entries.map((e) => e.source_trip_id).filter(Boolean))] as number[];
  const sourceTripRows =
    sourceTripIds.length > 0
      ? await asyncDb
          .prepare(`SELECT id, title FROM trips WHERE id IN (${sourceTripIds.map(() => '?').join(',')})`)
          .all<{ id: number; title: string }>(...sourceTripIds)
      : [];
  const sourceTripNames = new Map(sourceTripRows.map((t) => [t.id, t.title]));

  return entries.map((e) => ({
    ...e,
    tags: e.tags ? JSON.parse(e.tags) : [],
    pros_cons: e.pros_cons ? JSON.parse(e.pros_cons) : null,
    photos: photosByEntry[e.id] || [],
    source_trip_name: e.source_trip_id ? sourceTripNames.get(e.source_trip_id) || null : null,
  }));
}

export async function createEntry(
  journeyId: number,
  userId: number,
  data: {
    type?: string;
    title?: string;
    story?: string;
    entry_date: string;
    entry_time?: string;
    location_name?: string;
    location_lat?: number;
    location_lng?: number;
    mood?: string;
    weather?: string;
    tags?: string[];
    pros_cons?: { pros: string[]; cons: string[] };
    visibility?: string;
    sort_order?: number;
  },
  sid?: string,
): Promise<JourneyEntry | null> {
  if (!(await canEdit(journeyId, userId))) return null;

  const now = ts();
  const maxOrder = await asyncDb
    .prepare('SELECT MAX(sort_order) as m FROM journey_entries WHERE journey_id = ? AND entry_date = ?')
    .get<{ m: number | null }>(journeyId, data.entry_date);

  const prosConsJson =
    data.pros_cons && (data.pros_cons.pros.length || data.pros_cons.cons.length)
      ? JSON.stringify(data.pros_cons)
      : null;

  const res = await asyncDb
    .prepare(
      `
    INSERT INTO journey_entries (journey_id, author_id, type, title, story, entry_date, entry_time, location_name, location_lat, location_lng, mood, weather, tags, pros_cons, visibility, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      journeyId,
      userId,
      data.type || 'entry',
      data.title || null,
      data.story || null,
      data.entry_date,
      data.entry_time || null,
      data.location_name || null,
      data.location_lat ?? null,
      data.location_lng ?? null,
      data.mood || null,
      data.weather || null,
      data.tags?.length ? JSON.stringify(data.tags) : null,
      prosConsJson,
      data.visibility || 'private',
      (maxOrder?.m ?? -1) + 1,
      now,
      now,
    );

  const created = (await asyncDb
    .prepare('SELECT * FROM journey_entries WHERE id = ?')
    .get<JourneyEntry>(Number(res.lastInsertRowid)))!;
  await broadcastJourneyEvent(journeyId, 'journey:entry:created', { entry: created }, sid);
  return created;
}

export async function updateEntry(
  entryId: number,
  userId: number,
  data: Partial<{
    type: string;
    title: string;
    story: string;
    entry_date: string;
    entry_time: string;
    location_name: string;
    location_lat: number;
    location_lng: number;
    mood: string;
    weather: string;
    tags: string[];
    pros_cons: { pros: string[]; cons: string[] };
    visibility: string;
    sort_order: number;
  }>,
  sid?: string,
): Promise<JourneyEntry | null> {
  const entry = await asyncDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get<JourneyEntry>(entryId);
  if (!entry) return null;
  if (!(await canEdit(entry.journey_id, userId))) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  // Allow-list the columns a client may set: keys come from the request body
  // and are interpolated as SQL column names, so restrict them to the known
  // entry fields. Keep this in sync with the data type above.
  const allowed = new Set([
    'type',
    'title',
    'story',
    'entry_date',
    'entry_time',
    'location_name',
    'location_lat',
    'location_lng',
    'mood',
    'weather',
    'tags',
    'pros_cons',
    'visibility',
    'sort_order',
  ]);

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) continue;
    if (!allowed.has(key)) continue;
    if (key === 'tags') {
      fields.push('tags = ?');
      values.push(Array.isArray(val) ? JSON.stringify(val) : val);
    } else if (key === 'pros_cons') {
      fields.push('pros_cons = ?');
      values.push(val && typeof val === 'object' ? JSON.stringify(val) : val);
    } else {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  // if adding story to a skeleton, promote to entry
  if (entry.type === 'skeleton' && data.story && data.story.trim()) {
    fields.push('type = ?');
    values.push('entry');
  }

  if (fields.length === 0) return entry;

  fields.push('updated_at = ?');
  values.push(ts());
  values.push(entryId);
  await asyncDb.prepare(`UPDATE journey_entries SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // touch the journey
  await asyncDb.prepare('UPDATE journeys SET updated_at = ? WHERE id = ?').run(ts(), entry.journey_id);

  const updated = (await asyncDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get<JourneyEntry>(entryId))!;
  await broadcastJourneyEvent(entry.journey_id, 'journey:entry:updated', { entry: updated }, sid);
  return updated;
}

// Reorder entries (typically within a single day). Caller passes the new
// desired order of ids; each entry's sort_order is set to its index in the
// array. Only entries owned by this journey are accepted.
export async function reorderEntries(
  journeyId: number,
  userId: number,
  orderedIds: number[],
  sid?: string,
): Promise<boolean> {
  if (!(await canEdit(journeyId, userId))) return false;
  if (!orderedIds.length) return true;

  const placeholders = orderedIds.map(() => '?').join(',');
  const rows = await asyncDb
    .prepare(`SELECT id FROM journey_entries WHERE id IN (${placeholders}) AND journey_id = ?`)
    .all<{ id: number }>(...orderedIds, journeyId);
  if (rows.length !== orderedIds.length) return false;

  const now = ts();
  const update = asyncDb.prepare('UPDATE journey_entries SET sort_order = ?, updated_at = ? WHERE id = ?');
  await asyncDb.transaction(async () => {
    for (const [index, id] of orderedIds.entries()) await update.run(index, now, id);
    await asyncDb.prepare('UPDATE journeys SET updated_at = ? WHERE id = ?').run(now, journeyId);
  })();

  await broadcastJourneyEvent(journeyId, 'journey:entries:reordered', { orderedIds }, sid);
  return true;
}

export async function deleteEntry(entryId: number, userId: number, sid?: string): Promise<boolean> {
  const entry = await asyncDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get<JourneyEntry>(entryId);
  if (!entry) return false;
  if (!(await canEdit(entry.journey_id, userId))) return false;

  if (entry.source_trip_id && entry.source_place_id && entry.type !== 'skeleton') {
    // Revert filled entry back to skeleton instead of deleting
    await asyncDb.prepare(
      `
      UPDATE journey_entries
      SET type = 'skeleton', story = NULL, mood = NULL, weather = NULL, pros_cons = NULL,
          visibility = 'private', updated_at = ?
      WHERE id = ?
    `,
    ).run(ts(), entryId);
    await broadcastJourneyEvent(entry.journey_id, 'journey:entry:updated', { entryId }, sid);
  } else {
    await asyncDb.prepare('DELETE FROM journey_entries WHERE id = ?').run(entryId);
    await broadcastJourneyEvent(entry.journey_id, 'journey:entry:deleted', { entryId }, sid);
  }

  return true;
}

// ── Photos ───────────────────────────────────────────────────────────────

// Promote a skeleton suggestion to a concrete entry. Called whenever the user
// adds content (photo upload, provider photo, gallery link) — a suggestion
// with photos is no longer just a suggestion.
async function promoteSkeletonIfNeeded(entry: JourneyEntry): Promise<void> {
  if (entry.type !== 'skeleton') return;
  await asyncDb.prepare('UPDATE journey_entries SET type = ?, updated_at = ? WHERE id = ?').run('entry', ts(), entry.id);
}

// Ensure a trippi_photo_id is in the journey gallery; return its gallery row id.
async function ensureInGallery(
  journeyId: number,
  trippiPhotoId: number,
  caption?: string,
  shared?: number,
): Promise<number> {
  const now = ts();
  const maxOrderRow = await asyncDb
    .prepare('SELECT MAX(sort_order) as m FROM journey_photos WHERE journey_id = ?')
    .get<{ m: number | null }>(journeyId);
  await asyncDb
    .prepare(
      `
    INSERT OR IGNORE INTO journey_photos (journey_id, photo_id, caption, shared, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(journeyId, trippiPhotoId, caption || null, shared ?? 0, (maxOrderRow?.m ?? -1) + 1, now);
  const row = await asyncDb
    .prepare('SELECT id FROM journey_photos WHERE journey_id = ? AND photo_id = ?')
    .get<{ id: number }>(journeyId, trippiPhotoId);
  return row!.id;
}

// Link a gallery photo to an entry (idempotent). Returns the junction JP_SELECT row.
async function linkGalleryPhotoToEntry(galleryId: number, entryId: number): Promise<JourneyPhoto | null> {
  const now = ts();
  const maxOrderRow = await asyncDb
    .prepare('SELECT MAX(sort_order) as m FROM journey_entry_photos WHERE entry_id = ?')
    .get<{ m: number | null }>(entryId);
  await asyncDb
    .prepare(
      `
    INSERT OR IGNORE INTO journey_entry_photos (entry_id, journey_photo_id, sort_order, created_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(entryId, galleryId, (maxOrderRow?.m ?? -1) + 1, now);
  return (
    (await asyncDb
      .prepare(`SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE jep.entry_id = ? AND jep.journey_photo_id = ?`)
      .get<JourneyPhoto>(entryId, galleryId)) || null
  );
}

export async function addPhoto(
  entryId: number,
  userId: number,
  filePath: string,
  thumbnailPath?: string,
  caption?: string,
): Promise<JourneyPhoto | null> {
  const entry = await asyncDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get<JourneyEntry>(entryId);
  if (!entry) return null;
  if (!(await canEdit(entry.journey_id, userId))) return null;

  const trippiPhotoId = await getOrCreateLocalTrippiPhotoAsync(filePath, thumbnailPath);
  const galleryId = await asyncDb.transaction(async () => ensureInGallery(entry.journey_id, trippiPhotoId, caption))();
  const result = await linkGalleryPhotoToEntry(galleryId, entryId);
  await promoteSkeletonIfNeeded(entry);
  return result;
}

export async function addProviderPhoto(
  entryId: number,
  userId: number,
  provider: string,
  assetId: string,
  caption?: string,
  passphrase?: string,
): Promise<JourneyPhoto | null> {
  const entry = await asyncDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get<JourneyEntry>(entryId);
  if (!entry) return null;
  if (!(await canEdit(entry.journey_id, userId))) return null;

  const trippiPhotoId = await getOrCreateTrippiPhotoAsync(provider, assetId, userId, passphrase);

  // skip if this photo is already linked to this entry
  const alreadyLinked = await asyncDb
    .prepare(
      `
    SELECT 1 FROM journey_entry_photos jep
    JOIN journey_photos gp ON gp.id = jep.journey_photo_id
    WHERE jep.entry_id = ? AND gp.photo_id = ?
  `,
    )
    .get(entryId, trippiPhotoId);
  if (alreadyLinked) return null;

  const galleryId = await asyncDb.transaction(async () => ensureInGallery(entry.journey_id, trippiPhotoId, caption))();
  const result = await linkGalleryPhotoToEntry(galleryId, entryId);
  await promoteSkeletonIfNeeded(entry);
  return result;
}

// Link a gallery photo (by its journey_photos.id) to an entry — idempotent.
export async function linkPhotoToEntry(
  entryId: number,
  journeyPhotoId: number,
  userId: number,
): Promise<JourneyPhoto | null> {
  const entry = await asyncDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get<JourneyEntry>(entryId);
  if (!entry) return null;
  if (!(await canEdit(entry.journey_id, userId))) return null;

  // Verify the gallery photo belongs to this journey
  const galleryRow = await asyncDb
    .prepare('SELECT id, journey_id FROM journey_photos WHERE id = ?')
    .get<{ id: number; journey_id: number }>(journeyPhotoId);
  if (!galleryRow || galleryRow.journey_id !== entry.journey_id) return null;

  const result = await linkGalleryPhotoToEntry(galleryRow.id, entryId);
  await promoteSkeletonIfNeeded(entry);
  return result;
}

// Upload photos to the journey gallery only (no entry association).
export async function uploadGalleryPhotos(
  journeyId: number,
  userId: number,
  filePaths: { path: string; thumbnail?: string }[],
): Promise<JourneyPhoto[]> {
  if (!(await canEdit(journeyId, userId))) return [];
  const results: JourneyPhoto[] = [];
  const now = ts();
  const maxOrderRow = await asyncDb
    .prepare('SELECT MAX(sort_order) as m FROM journey_photos WHERE journey_id = ?')
    .get<{ m: number | null }>(journeyId);
  let nextOrder = (maxOrderRow?.m ?? -1) + 1;

  for (const f of filePaths) {
    const trippiPhotoId = await getOrCreateLocalTrippiPhotoAsync(f.path, f.thumbnail);
    await asyncDb
      .prepare(
        `
      INSERT OR IGNORE INTO journey_photos (journey_id, photo_id, shared, sort_order, created_at)
      VALUES (?, ?, 0, ?, ?)
    `,
      )
      .run(journeyId, trippiPhotoId, nextOrder++, now);
    const row = await asyncDb
      .prepare(`SELECT ${GALLERY_SELECT} FROM ${GALLERY_JOIN} WHERE gp.journey_id = ? AND gp.photo_id = ?`)
      .get<JourneyPhoto>(journeyId, trippiPhotoId);
    if (row) results.push(row);
  }
  return results;
}

// Add a provider photo to the gallery only (no entry link).
export async function addProviderPhotoToGallery(
  journeyId: number,
  userId: number,
  provider: string,
  assetId: string,
  caption?: string,
  passphrase?: string,
): Promise<JourneyPhoto | null> {
  if (!(await canEdit(journeyId, userId))) return null;
  const trippiPhotoId = await getOrCreateTrippiPhotoAsync(provider, assetId, userId, passphrase);
  const galleryId = await asyncDb.transaction(async () => ensureInGallery(journeyId, trippiPhotoId, caption))();
  return (
    (await asyncDb.prepare(`SELECT ${GALLERY_SELECT} FROM ${GALLERY_JOIN} WHERE gp.id = ?`).get<JourneyPhoto>(galleryId)) ??
    null
  );
}

// Unlink a photo from a specific entry; gallery row is preserved.
export async function unlinkPhotoFromEntry(entryId: number, journeyPhotoId: number, userId: number): Promise<boolean> {
  const entry = await asyncDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get<JourneyEntry>(entryId);
  if (!entry) return false;
  if (!(await canEdit(entry.journey_id, userId))) return false;

  const result = await asyncDb
    .prepare('DELETE FROM journey_entry_photos WHERE entry_id = ? AND journey_photo_id = ?')
    .run(entryId, journeyPhotoId);
  return result.changes > 0;
}

// Hard-delete a gallery photo (removes from all entries and the gallery).
export async function deleteGalleryPhoto(
  journeyPhotoId: number,
  userId: number,
): Promise<{ photo_id: number; file_path?: string | null } | null> {
  const row = await asyncDb
    .prepare('SELECT * FROM journey_photos WHERE id = ?')
    .get<{ id: number; journey_id: number; photo_id: number }>(journeyPhotoId);
  if (!row) return null;
  if (!(await canEdit(row.journey_id, userId))) return null;

  const trippiRow = await asyncDb
    .prepare('SELECT file_path, provider FROM trippi_photos WHERE id = ?')
    .get<{ file_path?: string; provider?: string }>(row.photo_id);

  // cascade on journey_entry_photos.journey_photo_id handles junction cleanup
  await asyncDb.prepare('DELETE FROM journey_photos WHERE id = ?').run(journeyPhotoId);
  await deleteTrippiPhotoIfOrphanAsync(row.photo_id);

  return { photo_id: row.photo_id, file_path: trippiRow?.file_path ?? null };
}

export async function setPhotoProvider(
  photoId: number,
  provider: string,
  assetId: string,
  ownerId: number,
): Promise<void> {
  // photoId = journey_photos.id (gallery row); look up the trippi_photo_id
  const jp = await asyncDb.prepare('SELECT photo_id FROM journey_photos WHERE id = ?').get<{ photo_id: number }>(photoId);
  if (!jp) return;
  await setTrippiPhotoProviderAsync(jp.photo_id, provider, assetId, ownerId);
  // also denorm on gallery row for fast reads
  await asyncDb
    .prepare('UPDATE journey_photos SET provider = ?, asset_id = ?, owner_id = ? WHERE id = ?')
    .run(provider, assetId, ownerId, photoId);
}

export async function updatePhoto(
  photoId: number,
  userId: number,
  data: { caption?: string; sort_order?: number },
): Promise<JourneyPhoto | null> {
  // photoId = journey_photos.id (gallery row)
  const row = await asyncDb
    .prepare('SELECT id, journey_id FROM journey_photos WHERE id = ?')
    .get<{ id: number; journey_id: number }>(photoId);
  if (!row) return null;
  if (!(await canEdit(row.journey_id, userId))) return null;

  // caption lives on the gallery row; sort_order lives on the junction table
  // (JP_SELECT reads jep.sort_order, so updating journey_photos.sort_order
  // would not be reflected in the returned row).
  if (data.caption !== undefined) {
    await asyncDb.prepare('UPDATE journey_photos SET caption = ? WHERE id = ?').run(data.caption, photoId);
  }
  if (data.sort_order !== undefined) {
    await asyncDb
      .prepare('UPDATE journey_entry_photos SET sort_order = ? WHERE journey_photo_id = ?')
      .run(data.sort_order, photoId);
  }
  return (
    (await asyncDb.prepare(`SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE gp.id = ? LIMIT 1`).get<JourneyPhoto>(photoId)) ??
    null
  );
}

// deletePhoto: hard-delete (backwards compat name used by old route).
export async function deletePhoto(
  photoId: number,
  userId: number,
): Promise<{ id: number; photo_id: number; file_path?: string | null; journey_id: number } | null> {
  const row = await asyncDb
    .prepare('SELECT id, journey_id, photo_id FROM journey_photos WHERE id = ?')
    .get<{ id: number; journey_id: number; photo_id: number }>(photoId);
  if (!row) return null;
  if (!(await canEdit(row.journey_id, userId))) return null;

  const trippiRow = await asyncDb
    .prepare('SELECT file_path, provider FROM trippi_photos WHERE id = ?')
    .get<{ file_path?: string; provider?: string }>(row.photo_id);

  await asyncDb.prepare('DELETE FROM journey_photos WHERE id = ?').run(photoId);
  await deleteTrippiPhotoIfOrphanAsync(row.photo_id);

  return { id: row.id, photo_id: row.photo_id, file_path: trippiRow?.file_path ?? null, journey_id: row.journey_id };
}

// ── Contributors ─────────────────────────────────────────────────────────

export async function addContributor(
  journeyId: number,
  userId: number,
  targetUserId: number,
  role: 'editor' | 'viewer',
): Promise<boolean> {
  if (!(await isOwner(journeyId, userId))) return false;
  if (targetUserId === userId) return false;
  try {
    await asyncDb
      .prepare('INSERT OR REPLACE INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
      .run(journeyId, targetUserId, role, ts());
    await broadcastJourneyEvent(journeyId, 'journey:contributor:changed', { targetUserId, role });
    return true;
  } catch {
    return false;
  }
}

export async function updateContributorRole(
  journeyId: number,
  userId: number,
  targetUserId: number,
  role: 'editor' | 'viewer',
): Promise<boolean> {
  if (!(await isOwner(journeyId, userId))) return false;
  await asyncDb
    .prepare('UPDATE journey_contributors SET role = ? WHERE journey_id = ? AND user_id = ?')
    .run(role, journeyId, targetUserId);
  await broadcastJourneyEvent(journeyId, 'journey:contributor:changed', { targetUserId, role });
  return true;
}

export async function removeContributor(journeyId: number, userId: number, targetUserId: number): Promise<boolean> {
  if (!(await isOwner(journeyId, userId))) return false;
  await asyncDb
    .prepare("DELETE FROM journey_contributors WHERE journey_id = ? AND user_id = ? AND role != 'owner'")
    .run(journeyId, targetUserId);
  return true;
}

// ── Suggestions ──────────────────────────────────────────────────────────

export async function getSuggestions(userId: number) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return asyncDb
    .prepare(
      `
    SELECT t.id, t.title, t.start_date, t.end_date, t.cover_image,
      (SELECT COUNT(*) FROM places p INNER JOIN day_assignments da ON da.place_id = p.id WHERE p.trip_id = t.id) as place_count
    FROM trips t
    LEFT JOIN trip_members tm ON t.id = tm.trip_id AND tm.user_id = ?
    WHERE (t.user_id = ? OR tm.user_id = ?)
      AND t.end_date IS NOT NULL
      AND t.end_date >= ?
      AND t.end_date <= date('now')
      AND t.id NOT IN (SELECT trip_id FROM journey_trips)
    ORDER BY t.end_date DESC
  `,
    )
    .all(userId, userId, userId, thirtyDaysAgo);
}

// ── User trips (for trip picker) ─────────────────────────────────────────

export async function listUserTrips(userId: number) {
  return asyncDb
    .prepare(
      `
    SELECT t.id, t.title, t.start_date, t.end_date, t.cover_image,
      (SELECT COUNT(*) FROM places p INNER JOIN day_assignments da ON da.place_id = p.id WHERE p.trip_id = t.id) as place_count
    FROM trips t
    LEFT JOIN trip_members tm ON t.id = tm.trip_id AND tm.user_id = ?
    WHERE t.user_id = ? OR tm.user_id = ?
    ORDER BY t.start_date DESC
  `,
    )
    .all(userId, userId, userId);
}
