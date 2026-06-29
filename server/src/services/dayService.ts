import { asyncDb } from '../db/asyncDatabase';
import { AssignmentRow, Day, DayNote } from '../types';
import {
  loadTagsByPlaceIdsAsync,
  loadParticipantsByAssignmentIdsAsync,
  formatAssignmentWithPlace,
} from './queryHelpers';

export { verifyTripAccess } from './tripAccess';

// ---------------------------------------------------------------------------
// Day assignment helpers
// ---------------------------------------------------------------------------

export async function getAssignmentsForDay(dayId: number | string) {
  const assignments = await asyncDb
    .prepare(
      `
    SELECT da.*, p.id as place_id, p.name as place_name, p.description as place_description,
      p.lat, p.lng, p.address, p.category_id, p.price, p.currency as place_currency,
      COALESCE(da.assignment_time, p.place_time) as place_time,
      COALESCE(da.assignment_end_time, p.end_time) as end_time,
      p.duration_minutes, p.notes as place_notes,
      p.image_url, p.transport_mode, p.google_place_id, p.google_ftid, p.website, p.phone,
      c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM day_assignments da
    JOIN places p ON da.place_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE da.day_id = ?
    ORDER BY da.order_index ASC, da.created_at ASC
  `,
    )
    .all<AssignmentRow>(dayId);

  const tagsByPlaceId = await loadTagsByPlaceIdsAsync([...new Set(assignments.map((a) => a.place_id))]);

  return assignments.map((a) => {
    return {
      id: a.id,
      day_id: a.day_id,
      order_index: a.order_index,
      notes: a.notes,
      created_at: a.created_at,
      place: {
        id: a.place_id,
        name: a.place_name,
        description: a.place_description,
        lat: a.lat,
        lng: a.lng,
        address: a.address,
        category_id: a.category_id,
        price: a.price,
        currency: a.place_currency,
        place_time: a.place_time,
        end_time: a.end_time,
        duration_minutes: a.duration_minutes,
        notes: a.place_notes,
        image_url: a.image_url,
        transport_mode: a.transport_mode,
        google_place_id: a.google_place_id,
        google_ftid: a.google_ftid,
        website: a.website,
        phone: a.phone,
        category: a.category_id
          ? {
              id: a.category_id,
              name: a.category_name,
              color: a.category_color,
              icon: a.category_icon,
            }
          : null,
        tags: tagsByPlaceId[a.place_id] || [],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Day CRUD
// ---------------------------------------------------------------------------

export async function listDays(tripId: string | number) {
  const days = await asyncDb
    .prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number ASC')
    .all<Day>(tripId);

  if (days.length === 0) {
    return { days: [] };
  }

  const dayIds = days.map((d) => d.id);
  const dayPlaceholders = dayIds.map(() => '?').join(',');

  const allAssignments = await asyncDb
    .prepare(
      `
    SELECT da.*, p.id as place_id, p.name as place_name, p.description as place_description,
      p.lat, p.lng, p.address, p.category_id, p.price, p.currency as place_currency,
      COALESCE(da.assignment_time, p.place_time) as place_time,
      COALESCE(da.assignment_end_time, p.end_time) as end_time,
      p.duration_minutes, p.notes as place_notes,
      p.image_url, p.transport_mode, p.google_place_id, p.google_ftid, p.website, p.phone,
      c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM day_assignments da
    JOIN places p ON da.place_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE da.day_id IN (${dayPlaceholders})
    ORDER BY da.order_index ASC, da.created_at ASC
  `,
    )
    .all<AssignmentRow>(...dayIds);

  const placeIds = [...new Set(allAssignments.map((a) => a.place_id))];
  const tagsByPlaceId = await loadTagsByPlaceIdsAsync(placeIds, { compact: true });

  const allAssignmentIds = allAssignments.map((a) => a.id);
  const participantsByAssignment = await loadParticipantsByAssignmentIdsAsync(allAssignmentIds);

  const assignmentsByDayId: Record<number, ReturnType<typeof formatAssignmentWithPlace>[]> = {};
  for (const a of allAssignments) {
    if (!assignmentsByDayId[a.day_id]) assignmentsByDayId[a.day_id] = [];
    assignmentsByDayId[a.day_id].push(
      formatAssignmentWithPlace(a, tagsByPlaceId[a.place_id] || [], participantsByAssignment[a.id] || []),
    );
  }

  const allNotes = await asyncDb
    .prepare(`SELECT * FROM day_notes WHERE day_id IN (${dayPlaceholders}) ORDER BY sort_order ASC, created_at ASC`)
    .all<DayNote>(...dayIds);
  const notesByDayId: Record<number, DayNote[]> = {};
  for (const note of allNotes) {
    if (!notesByDayId[note.day_id]) notesByDayId[note.day_id] = [];
    notesByDayId[note.day_id].push(note);
  }

  const daysWithAssignments = days.map((day) => ({
    ...day,
    assignments: assignmentsByDayId[day.id] || [],
    notes_items: notesByDayId[day.id] || [],
  }));

  return { days: daysWithAssignments };
}

export async function createDay(tripId: string | number, date?: string, notes?: string) {
  const maxDay = await asyncDb
    .prepare('SELECT MAX(day_number) as max FROM days WHERE trip_id = ?')
    .get<{ max: number | null }>(tripId);
  const dayNumber = (maxDay?.max || 0) + 1;

  const result = await asyncDb
    .prepare('INSERT INTO days (trip_id, day_number, date, notes) VALUES (?, ?, ?, ?)')
    .run(tripId, dayNumber, date || null, notes || null);

  const day = await asyncDb.prepare('SELECT * FROM days WHERE id = ?').get<Day>(result.lastInsertRowid);
  return { ...day, assignments: [] };
}

export async function getDay(id: string | number, tripId: string | number) {
  return asyncDb.prepare('SELECT * FROM days WHERE id = ? AND trip_id = ?').get<Day>(id, tripId);
}

export async function updateDay(id: string | number, current: Day, fields: { notes?: string; title?: string | null }) {
  await asyncDb.prepare('UPDATE days SET notes = ?, title = ? WHERE id = ?').run(
    fields.notes || null,
    'title' in fields ? (fields.title ?? null) : current.title,
    id,
  );
  const updatedDay = await asyncDb.prepare('SELECT * FROM days WHERE id = ?').get<Day>(id);
  return { ...updatedDay, assignments: await getAssignmentsForDay(id) };
}

export async function deleteDay(id: string | number) {
  await asyncDb.prepare('DELETE FROM days WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Day reorder / insert (#589)
//
// Reordering keeps every day ROW stable (so assignments, notes, accommodations,
// photos and multi-day reservation positions ride along by id) and only changes
// each row's day_number — its position. On a dated trip the calendar dates stay
// pinned to their slots (position i keeps the i-th date) and the day's content
// moves across them. Because a booking's day is derived from the date part of
// reservation_time, every booking on a day whose date changed gets that date
// re-stamped onto the day's new date (time-of-day preserved), so day_id stays
// consistent and the booking moves with its day.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * MS_PER_DAY;
  const dt = new Date(t);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dayDelta(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

/** Replace the date part of an ISO-ish timestamp, keeping any time suffix. */
function withDatePart(timestamp: string, date: string): string {
  return date + (timestamp.length > 10 ? timestamp.slice(10) : '');
}

/**
 * After day dates have been re-pinned, re-stamp the date of every booking on a
 * moved day so reservation_time/reservation_end_time follow their day's new
 * date (time-of-day preserved). Transport endpoints (flight legs) shift by the
 * same per-booking day delta so multi-leg timing stays internally consistent.
 */
async function restampReservationDates(
  tripId: string | number,
  oldDateById: Map<number, string | null>,
  newDateById: Map<number, string | null>,
): Promise<void> {
  const reservations = await asyncDb
    .prepare(
      'SELECT id, day_id, end_day_id, reservation_time, reservation_end_time FROM reservations WHERE trip_id = ?',
    )
    .all<{
    id: number;
    day_id: number | null;
    end_day_id: number | null;
    reservation_time: string | null;
    reservation_end_time: string | null;
  }>(tripId);

  const setTime = asyncDb.prepare('UPDATE reservations SET reservation_time = ? WHERE id = ?');
  const setEndTime = asyncDb.prepare('UPDATE reservations SET reservation_end_time = ? WHERE id = ?');
  const endpoints = asyncDb.prepare('SELECT id, local_date FROM reservation_endpoints WHERE reservation_id = ?');
  const setEndpointDate = asyncDb.prepare('UPDATE reservation_endpoints SET local_date = ? WHERE id = ?');

  for (const r of reservations) {
    if (r.day_id != null && r.reservation_time) {
      const oldDate = oldDateById.get(r.day_id);
      const newDate = newDateById.get(r.day_id);
      if (oldDate && newDate && oldDate !== newDate) {
        await setTime.run(withDatePart(r.reservation_time, newDate), r.id);
        // Shift each transport leg's local_date by the same number of days.
        const delta = dayDelta(oldDate, newDate);
        if (delta !== 0) {
          for (const ep of await endpoints.all<{ id: number; local_date: string | null }>(r.id)) {
            if (ep.local_date) await setEndpointDate.run(addDays(ep.local_date, delta), ep.id);
          }
        }
      }
    }
    if (r.end_day_id != null && r.reservation_end_time) {
      const oldDate = oldDateById.get(r.end_day_id);
      const newDate = newDateById.get(r.end_day_id);
      if (oldDate && newDate && oldDate !== newDate) {
        await setEndTime.run(withDatePart(r.reservation_end_time, newDate), r.id);
      }
    }
  }
}

/** A stay must not end before it begins after a reorder/insert. */
async function assertNoInvertedAccommodation(tripId: string | number): Promise<void> {
  const spans = await asyncDb
    .prepare(
      `
    SELECT a.id, s.day_number AS start_no, e.day_number AS end_no
    FROM day_accommodations a
    JOIN days s ON a.start_day_id = s.id
    JOIN days e ON a.end_day_id = e.id
    WHERE a.trip_id = ?
  `,
    )
    .all<{ id: number; start_no: number; end_no: number }>(tripId);
  for (const span of spans) {
    if (span.start_no > span.end_no) {
      throw new DayReorderError('This move would make an accommodation end before it starts.');
    }
  }
}

/** Thrown for invalid reorder/insert requests; mapped to HTTP 400 by the controller. */
export class DayReorderError extends Error {}

/**
 * Reorder whole days. `orderedIds` is the desired full sequence of this trip's
 * day ids (a permutation of the current ids).
 */
export async function reorderDays(tripId: string | number, orderedIds: number[]) {
  const rows = await asyncDb
    .prepare('SELECT id, day_number, date FROM days WHERE trip_id = ? ORDER BY day_number')
    .all<{ id: number; day_number: number; date: string | null }>(tripId);

  const existingIds = new Set(rows.map((r) => r.id));
  if (orderedIds.length !== rows.length || !orderedIds.every((id) => existingIds.has(id))) {
    throw new DayReorderError('orderedIds must be a permutation of the trip day ids.');
  }

  const oldDateById = new Map(rows.map((r) => [r.id, r.date]));
  // Dates stay pinned to slots: position i keeps the i-th date (ascending).
  const sortedDates = rows
    .map((r) => r.date)
    .filter((d): d is string => !!d)
    .sort();
  const isDated = sortedDates.length > 0;

  const setDayNumber = asyncDb.prepare('UPDATE days SET day_number = ? WHERE id = ?');
  const setDayNumberAndDate = asyncDb.prepare('UPDATE days SET day_number = ?, date = ? WHERE id = ?');

  await asyncDb.transaction(async () => {
    // Two-phase renumber to dodge UNIQUE(trip_id, day_number) collisions.
    for (const [i, id] of orderedIds.entries()) await setDayNumber.run(-(i + 1), id);
    const newDateById = new Map<number, string | null>();
    for (const [i, id] of orderedIds.entries()) {
      const date = isDated ? (sortedDates[i] ?? null) : null;
      await setDayNumberAndDate.run(i + 1, date, id);
      newDateById.set(id, date);
    }

    if (isDated) await restampReservationDates(tripId, oldDateById, newDateById);
    await assertNoInvertedAccommodation(tripId);
  })();

  return listDays(tripId);
}

/**
 * Insert a new empty day at a 1-based position (default: append at the end).
 * On a dated trip the trip gains one calendar day: dates re-pin so the slots
 * stay contiguous, the trip's end_date extends by one day, and bookings on
 * shifted days have their dates re-stamped (same rules as reorderDays).
 */
export async function insertDay(tripId: string | number, position?: number) {
  const rows = await asyncDb
    .prepare('SELECT id, day_number, date FROM days WHERE trip_id = ? ORDER BY day_number')
    .all<{ id: number; day_number: number; date: string | null }>(tripId);
  const n = rows.length;
  const pos = Math.min(Math.max(position ?? n + 1, 1), n + 1);
  const datedRows = rows.filter((r) => r.date) as { id: number; day_number: number; date: string }[];
  const isDated = datedRows.length > 0;

  const setDayNumber = asyncDb.prepare('UPDATE days SET day_number = ? WHERE id = ?');

  if (!isDated) {
    return asyncDb.transaction(async () => {
      const toShift = rows.filter((r) => r.day_number >= pos);
      for (const r of toShift) await setDayNumber.run(-r.day_number, r.id);
      const result = await asyncDb
        .prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, NULL)')
        .run(tripId, pos);
      for (const r of toShift) await setDayNumber.run(r.day_number + 1, r.id);
      const day = await asyncDb.prepare('SELECT * FROM days WHERE id = ?').get<Day>(result.lastInsertRowid);
      return { ...day, assignments: [], notes_items: [] };
    })();
  }

  // Dated trip: rebuild N+1 contiguous dates from the earliest date.
  const start = datedRows.map((r) => r.date).sort()[0];
  const dates = Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
  const oldDateById = new Map(rows.map((r) => [r.id, r.date]));
  const setDayNumberAndDate = asyncDb.prepare('UPDATE days SET day_number = ?, date = ? WHERE id = ?');

  return asyncDb.transaction(async () => {
    for (const [i, r] of rows.entries()) await setDayNumber.run(-(i + 1), r.id);
    const result = await asyncDb
      .prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, ?)')
      .run(tripId, pos, dates[pos - 1]);
    const newId = Number(result.lastInsertRowid);

    const orderedIds = rows.map((r) => r.id);
    orderedIds.splice(pos - 1, 0, newId);
    const newDateById = new Map<number, string | null>();
    for (const [i, id] of orderedIds.entries()) {
      await setDayNumberAndDate.run(i + 1, dates[i], id);
      newDateById.set(id, dates[i]);
    }

    await restampReservationDates(tripId, oldDateById, newDateById);
    await assertNoInvertedAccommodation(tripId);
    await asyncDb.prepare('UPDATE trips SET end_date = ? WHERE id = ?').run(dates[dates.length - 1], tripId);

    const day = await asyncDb.prepare('SELECT * FROM days WHERE id = ?').get<Day>(newId);
    return { ...day, assignments: [], notes_items: [] };
  })();
}

// ---------------------------------------------------------------------------
// Accommodation helpers
// ---------------------------------------------------------------------------

export interface DayAccommodation {
  id: number;
  trip_id: number;
  place_id: number | null;
  start_day_id: number;
  end_day_id: number;
  check_in: string | null;
  check_in_end: string | null;
  check_out: string | null;
  confirmation: string | null;
  notes: string | null;
  mcp_import_batch_id?: string | null;
}

async function getAccommodationWithPlace(id: number | bigint | string) {
  return asyncDb
    .prepare(
      `
    SELECT a.*, p.name as place_name, p.address as place_address, p.image_url as place_image, p.lat as place_lat, p.lng as place_lng
    FROM day_accommodations a
    LEFT JOIN places p ON a.place_id = p.id
    WHERE a.id = ?
  `,
    )
    .get(id);
}

// ---------------------------------------------------------------------------
// Accommodation CRUD
// ---------------------------------------------------------------------------

export async function listAccommodations(tripId: string | number) {
  return asyncDb
    .prepare(
      `
    SELECT a.*, p.name as place_name, p.address as place_address, p.image_url as place_image, p.lat as place_lat, p.lng as place_lng,
           r.title as reservation_title
    FROM day_accommodations a
    LEFT JOIN places p ON a.place_id = p.id
    LEFT JOIN reservations r ON r.accommodation_id = a.id
    WHERE a.trip_id = ?
    ORDER BY a.created_at ASC
  `,
    )
    .all(tripId);
}

export async function validateAccommodationRefs(
  tripId: string | number,
  placeId?: number,
  startDayId?: number,
  endDayId?: number,
) {
  const errors: { field: string; message: string }[] = [];
  if (placeId !== undefined) {
    const place = await asyncDb.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(placeId, tripId);
    if (!place) errors.push({ field: 'place_id', message: 'Place not found' });
  }
  if (startDayId !== undefined) {
    const startDay = await asyncDb
      .prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?')
      .get(startDayId, tripId);
    if (!startDay) errors.push({ field: 'start_day_id', message: 'Start day not found' });
  }
  if (endDayId !== undefined) {
    const endDay = await asyncDb.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(endDayId, tripId);
    if (!endDay) errors.push({ field: 'end_day_id', message: 'End day not found' });
  }
  return errors;
}

interface CreateAccommodationData {
  place_id: number;
  start_day_id: number;
  end_day_id: number;
  check_in?: string;
  check_in_end?: string;
  check_out?: string;
  confirmation?: string;
  notes?: string;
  mcp_import_batch_id?: string;
}

export async function createAccommodation(tripId: string | number, data: CreateAccommodationData) {
  const {
    place_id,
    start_day_id,
    end_day_id,
    check_in,
    check_in_end,
    check_out,
    confirmation,
    notes,
    mcp_import_batch_id,
  } = data;

  const result = await asyncDb
    .prepare(
      `INSERT INTO day_accommodations
        (trip_id, place_id, start_day_id, end_day_id, check_in, check_in_end, check_out, confirmation, notes, mcp_import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tripId,
      place_id,
      start_day_id,
      end_day_id,
      check_in || null,
      check_in_end || null,
      check_out || null,
      confirmation || null,
      notes || null,
      mcp_import_batch_id || null,
    );

  const accommodationId = result.lastInsertRowid;

  // Auto-create linked reservation for this accommodation
  const placeName =
    (await asyncDb.prepare('SELECT name FROM places WHERE id = ?').get<{ name: string }>(place_id))?.name || 'Hotel';
  const startDayDate =
    (await asyncDb.prepare('SELECT date FROM days WHERE id = ?').get<{ date: string }>(start_day_id))?.date || null;
  const meta: Record<string, string> = {};
  if (check_in) meta.check_in_time = check_in;
  if (check_in_end) meta.check_in_end_time = check_in_end;
  if (check_out) meta.check_out_time = check_out;
  await asyncDb.prepare(
    `
    INSERT INTO reservations
      (trip_id, day_id, title, reservation_time, location, confirmation_number, notes, status, type, accommodation_id, metadata, mcp_import_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 'hotel', ?, ?, ?)
  `,
  ).run(
    tripId,
    start_day_id,
    placeName,
    startDayDate || null,
    null,
    confirmation || null,
    notes || null,
    accommodationId,
    Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    mcp_import_batch_id || null,
  );

  return getAccommodationWithPlace(accommodationId);
}

export async function getAccommodation(id: string | number, tripId: string | number) {
  return asyncDb
    .prepare('SELECT * FROM day_accommodations WHERE id = ? AND trip_id = ?')
    .get<DayAccommodation>(id, tripId);
}

export async function updateAccommodation(
  id: string | number,
  existing: DayAccommodation,
  fields: {
    place_id?: number;
    start_day_id?: number;
    end_day_id?: number;
    check_in?: string;
    check_in_end?: string;
    check_out?: string;
    confirmation?: string;
    notes?: string;
  },
) {
  const newPlaceId = fields.place_id !== undefined ? fields.place_id : existing.place_id;
  const newStartDayId = fields.start_day_id !== undefined ? fields.start_day_id : existing.start_day_id;
  const newEndDayId = fields.end_day_id !== undefined ? fields.end_day_id : existing.end_day_id;
  const newCheckIn = fields.check_in !== undefined ? fields.check_in : existing.check_in;
  const newCheckInEnd = fields.check_in_end !== undefined ? fields.check_in_end : existing.check_in_end;
  const newCheckOut = fields.check_out !== undefined ? fields.check_out : existing.check_out;
  const newConfirmation = fields.confirmation !== undefined ? fields.confirmation : existing.confirmation;
  const newNotes = fields.notes !== undefined ? fields.notes : existing.notes;

  await asyncDb.prepare(
    'UPDATE day_accommodations SET place_id = ?, start_day_id = ?, end_day_id = ?, check_in = ?, check_in_end = ?, check_out = ?, confirmation = ?, notes = ? WHERE id = ?',
  ).run(newPlaceId, newStartDayId, newEndDayId, newCheckIn, newCheckInEnd, newCheckOut, newConfirmation, newNotes, id);

  // Sync check-in/out/confirmation to linked reservation
  const linkedRes = await asyncDb
    .prepare('SELECT id, metadata FROM reservations WHERE accommodation_id = ?')
    .get<{ id: number; metadata: string | null }>(Number(id));
  if (linkedRes) {
    const meta = linkedRes.metadata ? JSON.parse(linkedRes.metadata) : {};
    if (newCheckIn) meta.check_in_time = newCheckIn;
    if (newCheckInEnd) meta.check_in_end_time = newCheckInEnd;
    if (newCheckOut) meta.check_out_time = newCheckOut;
    await asyncDb.prepare(
      'UPDATE reservations SET metadata = ?, confirmation_number = COALESCE(?, confirmation_number) WHERE id = ?',
    ).run(JSON.stringify(meta), newConfirmation || null, linkedRes.id);
  }

  return getAccommodationWithPlace(Number(id));
}

/** Delete accommodation and its linked reservation (and any linked budget item). */
export async function deleteAccommodation(id: string | number): Promise<{
  linkedReservationId: number | null;
  deletedBudgetItemId: number | null;
}> {
  const linkedRes = await asyncDb
    .prepare('SELECT id FROM reservations WHERE accommodation_id = ?')
    .get<{ id: number }>(Number(id));
  let deletedBudgetItemId: number | null = null;
  if (linkedRes) {
    const linkedBudget = await asyncDb
      .prepare('SELECT id FROM budget_items WHERE reservation_id = ?')
      .get<{ id: number }>(linkedRes.id);
    if (linkedBudget) {
      await asyncDb.prepare('DELETE FROM budget_items WHERE id = ?').run(linkedBudget.id);
      deletedBudgetItemId = linkedBudget.id;
    }
    await asyncDb.prepare('DELETE FROM reservations WHERE id = ?').run(linkedRes.id);
  }

  await asyncDb.prepare('DELETE FROM day_accommodations WHERE id = ?').run(id);
  return { linkedReservationId: linkedRes ? linkedRes.id : null, deletedBudgetItemId };
}
