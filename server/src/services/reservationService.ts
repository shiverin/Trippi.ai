import { asyncDb } from '../db/asyncDatabase';
import type { BudgetItem, BudgetItemMember, BudgetItemPayer, Reservation } from '../types';
import { avatarUrl } from './avatarUrl';

export { verifyTripAccess } from './tripAccess';

export interface ReservationEndpoint {
  id?: number;
  reservation_id?: number;
  role: 'from' | 'to' | 'stop';
  sequence: number;
  name: string;
  code: string | null;
  lat: number;
  lng: number;
  timezone: string | null;
  local_time: string | null;
  local_date: string | null;
}

export type EndpointInput = Omit<ReservationEndpoint, 'id' | 'reservation_id' | 'sequence'> & { sequence?: number };

export async function loadEndpointsByTrip(tripId: string | number): Promise<Map<number, ReservationEndpoint[]>> {
  const rows = await asyncDb
    .prepare(
      `
    SELECT e.* FROM reservation_endpoints e
    JOIN reservations r ON e.reservation_id = r.id
    WHERE r.trip_id = ?
    ORDER BY e.reservation_id, e.sequence
  `,
    )
    .all<ReservationEndpoint>(tripId);
  const map = new Map<number, ReservationEndpoint[]>();
  for (const r of rows) {
    const list = map.get(r.reservation_id!) ?? [];
    list.push(r);
    map.set(r.reservation_id!, list);
  }
  return map;
}

async function loadEndpoints(reservationId: number): Promise<ReservationEndpoint[]> {
  return asyncDb
    .prepare('SELECT * FROM reservation_endpoints WHERE reservation_id = ? ORDER BY sequence')
    .all<ReservationEndpoint>(reservationId);
}

async function loadBudgetItemMembers(
  itemId: number | string | bigint,
): Promise<(BudgetItemMember & { avatar_url: string | null })[]> {
  const rows = await asyncDb
    .prepare(
      `
    SELECT bm.user_id, bm.paid, u.username, u.avatar
    FROM budget_item_members bm
    JOIN users u ON bm.user_id = u.id
    WHERE bm.budget_item_id = ?
  `,
    )
    .all<BudgetItemMember>(itemId);
  return rows.map((m) => ({ ...m, avatar_url: avatarUrl(m) }));
}

async function loadBudgetItemPayers(
  itemId: number | string | bigint,
): Promise<(BudgetItemPayer & { avatar_url: string | null })[]> {
  const rows = await asyncDb
    .prepare(
      `
    SELECT bp.user_id, bp.amount, u.username, u.avatar
    FROM budget_item_payers bp
    JOIN users u ON bp.user_id = u.id
    WHERE bp.budget_item_id = ?
  `,
    )
    .all<BudgetItemPayer>(itemId);
  return rows.map((p) => ({ ...p, avatar_url: avatarUrl(p) }));
}

async function hydrateBudgetItem(itemId: number | string | bigint): Promise<BudgetItem | null> {
  const item = await asyncDb.prepare('SELECT * FROM budget_items WHERE id = ?').get<BudgetItem>(itemId);
  if (!item) return null;
  item.members = await loadBudgetItemMembers(itemId);
  item.payers = await loadBudgetItemPayers(itemId);
  return item;
}

async function ensureBudgetCategoryOrder(tripId: string | number, category: string): Promise<void> {
  const exists = await asyncDb
    .prepare('SELECT 1 FROM budget_category_order WHERE trip_id = ? AND category = ?')
    .get(tripId, category);
  if (exists) return;

  const maxCatOrder = await asyncDb
    .prepare('SELECT MAX(sort_order) as max FROM budget_category_order WHERE trip_id = ?')
    .get<{ max: number | null }>(tripId);
  const catOrder = (maxCatOrder?.max !== null && maxCatOrder?.max !== undefined ? maxCatOrder.max : -1) + 1;
  await asyncDb
    .prepare('INSERT OR IGNORE INTO budget_category_order (trip_id, category, sort_order) VALUES (?, ?, ?)')
    .run(tripId, category, catOrder);
}

export async function getLinkedReservationBudgetItem(
  tripId: string | number,
  reservationId: string | number,
): Promise<Pick<BudgetItem, 'id' | 'category'> | undefined> {
  return asyncDb
    .prepare('SELECT id, category FROM budget_items WHERE trip_id = ? AND reservation_id = ?')
    .get<Pick<BudgetItem, 'id' | 'category'>>(tripId, reservationId);
}

export async function createLinkedBudgetItemForReservation(
  tripId: string | number,
  reservationId: number,
  data: { name: string; category?: string; total_price: number },
): Promise<BudgetItem> {
  const maxOrder = await asyncDb
    .prepare('SELECT MAX(sort_order) as max FROM budget_items WHERE trip_id = ?')
    .get<{ max: number | null }>(tripId);
  const sortOrder = (maxOrder?.max !== null && maxOrder?.max !== undefined ? maxOrder.max : -1) + 1;
  const category = data.category || 'other';

  await ensureBudgetCategoryOrder(tripId, category);

  const result = await asyncDb
    .prepare(
      'INSERT INTO budget_items (trip_id, category, name, total_price, currency, exchange_rate, persons, days, note, sort_order, expense_date, reservation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(tripId, category, data.name, data.total_price || 0, null, 1, null, null, null, sortOrder, null, reservationId);

  const item = await hydrateBudgetItem(Number(result.lastInsertRowid));
  if (!item) throw new Error('Failed to load created budget item');
  item.reservation_id = reservationId;
  return item;
}

export async function updateReservationBudgetItem(
  id: string | number,
  tripId: string | number,
  data: { category?: string; name?: string; total_price?: number },
): Promise<BudgetItem | null> {
  const item = await asyncDb
    .prepare('SELECT * FROM budget_items WHERE id = ? AND trip_id = ?')
    .get<BudgetItem>(id, tripId);
  if (!item) return null;

  const category = data.category || item.category;
  await asyncDb
    .prepare(
      `
    UPDATE budget_items SET
      category = ?,
      name = ?,
      total_price = ?
    WHERE id = ?
  `,
    )
    .run(category, data.name || item.name, data.total_price !== undefined ? data.total_price : item.total_price, id);

  if (data.category) {
    await ensureBudgetCategoryOrder(tripId, data.category);
  }

  return hydrateBudgetItem(id);
}

export async function deleteReservationBudgetItem(id: string | number, tripId: string | number): Promise<boolean> {
  const item = await asyncDb.prepare('SELECT id FROM budget_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return false;
  await asyncDb.prepare('DELETE FROM budget_items WHERE id = ?').run(id);
  return true;
}

// Resolve the day row whose date matches the date portion of an ISO-ish
// timestamp. Used to keep `day_id` / `end_day_id` in sync with
// `reservation_time` / `reservation_end_time` so non-transport bookings
// (tours, restaurants, events, ...) end up on the right day in the UI,
// which now filters by day_id instead of reservation_time.
async function resolveDayIdFromTime(tripId: string | number, time: string | null | undefined): Promise<number | null> {
  if (!time) return null;
  const datePart = time.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const row = await asyncDb
    .prepare('SELECT id FROM days WHERE trip_id = ? AND date = ? LIMIT 1')
    .get<{ id: number }>(tripId, datePart);
  return row?.id ?? null;
}

// After a trip's date range changes, generateDays positionally re-dates the day rows
// (keeping their ids), so a dated booking's day_id stays glued to a now-re-dated day and
// the booking visually shifts by the offset (#1288). Re-anchor non-hotel bookings to the
// day matching their absolute reservation_time — the same derivation create/updateReservation
// use. Only updates when a matching day exists, so a booking whose date now falls outside
// the new range is left untouched. Hotels keep their range on the linked day_accommodation.
export async function resyncReservationDays(tripId: string | number): Promise<void> {
  const rows = await asyncDb
    .prepare(
      `SELECT id, reservation_time, reservation_end_time, day_id, end_day_id
       FROM reservations
      WHERE trip_id = ? AND type != 'hotel' AND reservation_time IS NOT NULL`,
    )
    .all<{
      id: number;
      reservation_time: string | null;
      reservation_end_time: string | null;
      day_id: number | null;
      end_day_id: number | null;
    }>(tripId);
  const update = asyncDb.prepare('UPDATE reservations SET day_id = ?, end_day_id = ? WHERE id = ?');
  for (const r of rows) {
    const newDayId = await resolveDayIdFromTime(tripId, r.reservation_time);
    if (newDayId == null) continue;
    const newEndDayId = r.reservation_end_time
      ? ((await resolveDayIdFromTime(tripId, r.reservation_end_time)) ?? r.end_day_id)
      : r.end_day_id;
    if (newDayId !== r.day_id || newEndDayId !== r.end_day_id) {
      await update.run(newDayId, newEndDayId, r.id);
    }
  }
}

async function saveEndpoints(reservationId: number, endpoints: EndpointInput[]): Promise<void> {
  // Bind the transaction lazily on each call. Binding at module load time
  // captures the DB connection that was open then, which becomes invalid
  // after demo-reset / restore-from-backup closes and reinitialises the
  // connection — every later endpoint save would throw
  // "The database connection is not open".
  const tx = asyncDb.transaction(async (rid: number, eps: EndpointInput[]) => {
    await asyncDb.prepare('DELETE FROM reservation_endpoints WHERE reservation_id = ?').run(rid);
    const insert = asyncDb.prepare(`
      INSERT INTO reservation_endpoints (reservation_id, role, sequence, name, code, lat, lng, timezone, local_time, local_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [i, e] of eps.entries()) {
      await insert.run(
        rid,
        e.role,
        e.sequence ?? i,
        e.name,
        e.code ?? null,
        e.lat,
        e.lng,
        e.timezone ?? null,
        e.local_time ?? null,
        e.local_date ?? null,
      );
    }
  });
  await tx(reservationId, endpoints);
}

export async function listReservations(tripId: string | number) {
  const reservations = await asyncDb
    .prepare(
      `
    SELECT r.*, d.day_number, p.name as place_name, r.assignment_id,
      ap.place_id as accommodation_place_id, acc_p.name as accommodation_name,
      ap.start_day_id as accommodation_start_day_id, ap.end_day_id as accommodation_end_day_id
    FROM reservations r
    LEFT JOIN days d ON r.day_id = d.id
    LEFT JOIN places p ON r.place_id = p.id
    LEFT JOIN day_accommodations ap ON r.accommodation_id = ap.id
    LEFT JOIN places acc_p ON ap.place_id = acc_p.id
    WHERE r.trip_id = ?
    ORDER BY r.reservation_time ASC, r.created_at ASC
  `,
    )
    .all<any>(tripId);

  const dayPositions = await asyncDb
    .prepare(
      `
    SELECT rdp.reservation_id, rdp.day_id, rdp.position
    FROM reservation_day_positions rdp
    JOIN reservations r ON rdp.reservation_id = r.id
    WHERE r.trip_id = ?
  `,
    )
    .all<{ reservation_id: number; day_id: number; position: number }>(tripId);

  const posMap = new Map<number, Record<number, number>>();
  for (const dp of dayPositions) {
    if (!posMap.has(dp.reservation_id)) posMap.set(dp.reservation_id, {});
    posMap.get(dp.reservation_id)![dp.day_id] = dp.position;
  }

  const endpointsMap = await loadEndpointsByTrip(tripId);

  for (const r of reservations) {
    r.day_positions = posMap.get(r.id) || null;
    r.endpoints = endpointsMap.get(r.id) || [];
    // accommodation_id is a TEXT column; the integer FK reads back as a numeric
    // string (e.g. "14.0"). Normalize to an int so clients can parse it.
    r.accommodation_id = r.accommodation_id == null ? null : Math.trunc(Number(r.accommodation_id));
  }

  return reservations;
}

/**
 * Upcoming reservations across all of a user's active trips, soonest first.
 * Used by the dashboard's "Upcoming reservations" widget. A reservation counts
 * as upcoming when its own time is in the future, or — for timeless entries —
 * when its day falls on or after today. Cancelled bookings are skipped.
 */
export async function getUpcomingReservations(userId: number, limit = 6) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const reservations = await asyncDb
    .prepare(
      `
    SELECT r.id, r.trip_id, r.title, r.type, r.status, r.location,
           r.reservation_time, r.confirmation_number,
           t.title as trip_title, t.cover_image as trip_cover,
           d.date as day_date, p.name as place_name, p.image_url as place_image
    FROM reservations r
    JOIN trips t ON t.id = r.trip_id
    LEFT JOIN trip_members tm ON tm.trip_id = t.id AND tm.user_id = ?
    LEFT JOIN days d ON r.day_id = d.id
    LEFT JOIN places p ON r.place_id = p.id
    WHERE (t.user_id = ? OR tm.user_id IS NOT NULL)
      AND t.is_archived = 0
      AND r.status != 'cancelled'
      AND (
        (r.reservation_time IS NOT NULL AND r.reservation_time >= ?)
        OR (r.reservation_time IS NULL AND d.date IS NOT NULL AND d.date >= ?)
      )
    ORDER BY COALESCE(r.reservation_time, d.date) ASC
    LIMIT ?
  `,
    )
    .all<any>(userId, userId, now, today, limit);

  return reservations;
}

export async function getReservationWithJoins(id: string | number) {
  const row = await asyncDb
    .prepare(
      `
    SELECT r.*, d.day_number, p.name as place_name, r.assignment_id,
      ap.place_id as accommodation_place_id, acc_p.name as accommodation_name,
      ap.start_day_id as accommodation_start_day_id, ap.end_day_id as accommodation_end_day_id
    FROM reservations r
    LEFT JOIN days d ON r.day_id = d.id
    LEFT JOIN places p ON r.place_id = p.id
    LEFT JOIN day_accommodations ap ON r.accommodation_id = ap.id
    LEFT JOIN places acc_p ON ap.place_id = acc_p.id
    WHERE r.id = ?
  `,
    )
    .get<any>(id);
  if (!row) return undefined;
  row.endpoints = await loadEndpoints(row.id);
  // accommodation_id is a TEXT column; the integer FK reads back as a numeric
  // string (e.g. "14.0"). Normalize to an int so clients can parse it.
  row.accommodation_id = row.accommodation_id == null ? null : Math.trunc(Number(row.accommodation_id));
  return row;
}

interface CreateAccommodation {
  place_id?: number;
  start_day_id?: number;
  end_day_id?: number;
  check_in?: string;
  check_out?: string;
  confirmation?: string;
}

interface CreateReservationData {
  title: string;
  reservation_time?: string;
  reservation_end_time?: string;
  location?: string;
  confirmation_number?: string;
  notes?: string;
  day_id?: number;
  end_day_id?: number;
  place_id?: number;
  assignment_id?: number;
  status?: string;
  type?: string;
  accommodation_id?: number;
  metadata?: any;
  create_accommodation?: CreateAccommodation;
  endpoints?: EndpointInput[];
  needs_review?: boolean;
}

export async function createReservation(
  tripId: string | number,
  data: CreateReservationData,
): Promise<{ reservation: any; accommodationCreated: boolean }> {
  const {
    title,
    reservation_time,
    reservation_end_time,
    location,
    confirmation_number,
    notes,
    day_id,
    end_day_id,
    place_id,
    assignment_id,
    status,
    type,
    accommodation_id,
    metadata,
    create_accommodation,
    endpoints,
    needs_review,
  } = data;

  let accommodationCreated = false;

  // Auto-create accommodation for hotel reservations
  let resolvedAccommodationId: number | null = accommodation_id || null;
  if (type === 'hotel' && !resolvedAccommodationId && create_accommodation) {
    const {
      place_id: accPlaceId,
      start_day_id,
      end_day_id,
      check_in,
      check_out,
      confirmation: accConf,
    } = create_accommodation;
    if (start_day_id && end_day_id) {
      const accResult = await asyncDb
        .prepare(
          'INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id, check_in, check_out, confirmation) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          tripId,
          accPlaceId || null,
          start_day_id,
          end_day_id,
          check_in || null,
          check_out || null,
          accConf || confirmation_number || null,
        );
      resolvedAccommodationId = Number(accResult.lastInsertRowid);
      accommodationCreated = true;
    }
  }

  // Derive day_id / end_day_id from reservation_time when the client
  // didn't explicitly set them (non-hotel bookings only — hotels store
  // their date range on the linked day_accommodation).
  const resolvedType = type || 'other';
  let resolvedDayId: number | null = day_id ?? null;
  if (resolvedDayId == null && resolvedType !== 'hotel' && reservation_time) {
    resolvedDayId = await resolveDayIdFromTime(tripId, reservation_time);
  }
  let resolvedEndDayId: number | null = end_day_id ?? null;
  if (resolvedEndDayId == null && resolvedType !== 'hotel' && reservation_end_time) {
    resolvedEndDayId = await resolveDayIdFromTime(tripId, reservation_end_time);
  }

  const result = await asyncDb
    .prepare(
      `
    INSERT INTO reservations (trip_id, day_id, end_day_id, place_id, assignment_id, title, reservation_time, reservation_end_time, location, confirmation_number, notes, status, type, accommodation_id, metadata, needs_review)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      tripId,
      resolvedDayId,
      resolvedEndDayId,
      place_id || null,
      assignment_id || null,
      title,
      reservation_time || null,
      reservation_end_time || null,
      location || null,
      confirmation_number || null,
      notes || null,
      status || 'pending',
      resolvedType,
      resolvedAccommodationId,
      metadata ? JSON.stringify(metadata) : null,
      needs_review ? 1 : 0,
    );

  if (endpoints && endpoints.length > 0) {
    await saveEndpoints(Number(result.lastInsertRowid), endpoints);
  }

  // Sync check-in/out to accommodation if linked
  if (accommodation_id && metadata) {
    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (meta.check_in_time || meta.check_in_end_time || meta.check_out_time) {
      await asyncDb
        .prepare(
          'UPDATE day_accommodations SET check_in = COALESCE(?, check_in), check_in_end = COALESCE(?, check_in_end), check_out = COALESCE(?, check_out) WHERE id = ?',
        )
        .run(meta.check_in_time || null, meta.check_in_end_time || null, meta.check_out_time || null, accommodation_id);
    }
    if (confirmation_number) {
      await asyncDb
        .prepare('UPDATE day_accommodations SET confirmation = COALESCE(?, confirmation) WHERE id = ?')
        .run(confirmation_number, accommodation_id);
    }
  }

  const reservation = await getReservationWithJoins(Number(result.lastInsertRowid));
  return { reservation, accommodationCreated };
}

export async function updatePositions(
  tripId: string | number,
  positions: { id: number; day_plan_position: number }[],
  dayId?: number | string,
): Promise<void> {
  if (dayId) {
    // Per-day positions for multi-day reservations
    const stmt = asyncDb.prepare(
      'INSERT OR REPLACE INTO reservation_day_positions (reservation_id, day_id, position) VALUES (?, ?, ?)',
    );
    const updateMany = asyncDb.transaction(async (items: { id: number; day_plan_position: number }[]) => {
      for (const item of items) {
        await stmt.run(item.id, dayId, item.day_plan_position);
      }
    });
    await updateMany(positions);
  } else {
    // Legacy: update global position
    const stmt = asyncDb.prepare('UPDATE reservations SET day_plan_position = ? WHERE id = ? AND trip_id = ?');
    const updateMany = asyncDb.transaction(async (items: { id: number; day_plan_position: number }[]) => {
      for (const item of items) {
        await stmt.run(item.day_plan_position, item.id, tripId);
      }
    });
    await updateMany(positions);
  }
}

export async function getReservation(id: string | number, tripId: string | number): Promise<Reservation | undefined> {
  return asyncDb.prepare('SELECT * FROM reservations WHERE id = ? AND trip_id = ?').get<Reservation>(id, tripId);
}

interface UpdateReservationData {
  title?: string;
  reservation_time?: string;
  reservation_end_time?: string;
  location?: string;
  confirmation_number?: string;
  notes?: string;
  day_id?: number;
  end_day_id?: number | null;
  place_id?: number;
  assignment_id?: number;
  status?: string;
  type?: string;
  accommodation_id?: number;
  metadata?: any;
  create_accommodation?: CreateAccommodation;
  endpoints?: EndpointInput[];
  needs_review?: boolean;
}

export async function updateReservation(
  id: string | number,
  tripId: string | number,
  data: UpdateReservationData,
  current: Reservation,
): Promise<{ reservation: any; accommodationChanged: boolean }> {
  const {
    title,
    reservation_time,
    reservation_end_time,
    location,
    confirmation_number,
    notes,
    day_id,
    end_day_id,
    place_id,
    assignment_id,
    status,
    type,
    accommodation_id,
    metadata,
    create_accommodation,
    endpoints,
    needs_review,
  } = data;

  let accommodationChanged = false;

  // Update or create accommodation for hotel reservations
  let resolvedAccId: number | null =
    accommodation_id !== undefined ? accommodation_id || null : (current.accommodation_id ?? null);
  if (resolvedAccId) {
    const accExists = await asyncDb.prepare('SELECT id FROM day_accommodations WHERE id = ?').get(resolvedAccId);
    if (!accExists) resolvedAccId = null;
  }
  if (type === 'hotel' && create_accommodation) {
    const {
      place_id: accPlaceId,
      start_day_id,
      end_day_id,
      check_in,
      check_out,
      confirmation: accConf,
    } = create_accommodation;
    if (start_day_id && end_day_id) {
      if (resolvedAccId) {
        await asyncDb
          .prepare(
            'UPDATE day_accommodations SET place_id = ?, start_day_id = ?, end_day_id = ?, check_in = ?, check_out = ?, confirmation = ? WHERE id = ?',
          )
          .run(
            accPlaceId || null,
            start_day_id,
            end_day_id,
            check_in || null,
            check_out || null,
            accConf || confirmation_number || null,
            resolvedAccId,
          );
      } else if (accPlaceId) {
        const accResult = await asyncDb
          .prepare(
            'INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id, check_in, check_out, confirmation) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            tripId,
            accPlaceId,
            start_day_id,
            end_day_id,
            check_in || null,
            check_out || null,
            accConf || confirmation_number || null,
          );
        resolvedAccId = Number(accResult.lastInsertRowid);
      }
      accommodationChanged = true;
    }
  }

  const resolvedType = (type ?? current.type) || 'other';
  const nextReservationTime =
    resolvedType === 'hotel'
      ? null
      : reservation_time !== undefined
        ? reservation_time || null
        : current.reservation_time;
  const nextReservationEndTime =
    resolvedType === 'hotel'
      ? null
      : reservation_end_time !== undefined
        ? reservation_end_time || null
        : current.reservation_end_time;

  // day_id / end_day_id: honour an explicit value from the client,
  // otherwise derive from the (possibly updated) reservation_time so the
  // planner renders the booking on the correct day.
  let nextDayId: number | null;
  if (day_id != null) {
    // Explicit day from the client (e.g. moved on the planner).
    nextDayId = day_id;
  } else if (resolvedType !== 'hotel' && nextReservationTime) {
    // No day set but we have a date — pin it to the matching day so the booking
    // still shows in the Plan (covers bookings saved without a selected day, and
    // the case where an earlier edit cleared day_id).
    nextDayId = await resolveDayIdFromTime(tripId, nextReservationTime);
  } else if (day_id === undefined) {
    // Field absent and nothing to derive from — keep whatever it had.
    nextDayId = current.day_id ?? null;
  } else {
    nextDayId = null;
  }

  let nextEndDayId: number | null;
  if (end_day_id !== undefined) {
    nextEndDayId = end_day_id ?? null;
  } else if (reservation_end_time !== undefined && resolvedType !== 'hotel') {
    nextEndDayId = await resolveDayIdFromTime(tripId, nextReservationEndTime);
  } else {
    nextEndDayId = (current as any).end_day_id ?? null;
  }

  await asyncDb
    .prepare(
      `
    UPDATE reservations SET
      title = ?,
      reservation_time = ?,
      reservation_end_time = ?,
      location = ?,
      confirmation_number = ?,
      notes = ?,
      day_id = ?,
      end_day_id = ?,
      place_id = ?,
      assignment_id = ?,
      status = ?,
      type = ?,
      accommodation_id = ?,
      metadata = ?,
      needs_review = ?
    WHERE id = ?
  `,
    )
    .run(
      title || current.title,
      nextReservationTime,
      nextReservationEndTime,
      location !== undefined ? location || null : current.location,
      confirmation_number !== undefined ? confirmation_number || null : current.confirmation_number,
      notes !== undefined ? notes || null : current.notes,
      nextDayId,
      nextEndDayId,
      place_id !== undefined ? place_id || null : current.place_id,
      assignment_id !== undefined ? assignment_id || null : current.assignment_id,
      status || current.status,
      type || current.type,
      resolvedAccId,
      metadata !== undefined ? (metadata ? JSON.stringify(metadata) : null) : current.metadata,
      needs_review === undefined ? (current as any).needs_review : needs_review ? 1 : 0,
      id,
    );

  if (endpoints !== undefined) {
    await saveEndpoints(Number(id), endpoints);
  }

  // Sync check-in/out to accommodation if linked
  const resolvedMeta =
    metadata !== undefined ? metadata : current.metadata ? JSON.parse(current.metadata as string) : null;
  if (resolvedAccId && resolvedMeta) {
    const meta = typeof resolvedMeta === 'string' ? JSON.parse(resolvedMeta) : resolvedMeta;
    if (meta.check_in_time || meta.check_in_end_time || meta.check_out_time) {
      await asyncDb
        .prepare(
          'UPDATE day_accommodations SET check_in = COALESCE(?, check_in), check_in_end = COALESCE(?, check_in_end), check_out = COALESCE(?, check_out) WHERE id = ?',
        )
        .run(meta.check_in_time || null, meta.check_in_end_time || null, meta.check_out_time || null, resolvedAccId);
    }
    const resolvedConf = confirmation_number !== undefined ? confirmation_number : current.confirmation_number;
    if (resolvedConf) {
      await asyncDb
        .prepare('UPDATE day_accommodations SET confirmation = COALESCE(?, confirmation) WHERE id = ?')
        .run(resolvedConf, resolvedAccId);
    }
  }

  const reservation = await getReservationWithJoins(id);
  return { reservation, accommodationChanged };
}

export async function deleteReservation(
  id: string | number,
  tripId: string | number,
): Promise<{
  deleted: { id: number; title: string; type: string; accommodation_id: number | null } | undefined;
  accommodationDeleted: boolean;
  deletedBudgetItemId: number | null;
}> {
  const reservation = await asyncDb
    .prepare('SELECT id, title, type, accommodation_id FROM reservations WHERE id = ? AND trip_id = ?')
    .get<{ id: number; title: string; type: string; accommodation_id: number | null }>(id, tripId);
  if (!reservation) return { deleted: undefined, accommodationDeleted: false, deletedBudgetItemId: null };

  let accommodationDeleted = false;
  if (reservation.accommodation_id) {
    await asyncDb.prepare('DELETE FROM day_accommodations WHERE id = ?').run(reservation.accommodation_id);
    accommodationDeleted = true;
  }

  const linkedBudget = await asyncDb
    .prepare('SELECT id FROM budget_items WHERE trip_id = ? AND reservation_id = ?')
    .get<{ id: number }>(tripId, id);
  if (linkedBudget) {
    await asyncDb.prepare('DELETE FROM budget_items WHERE id = ?').run(linkedBudget.id);
  }

  await asyncDb.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  return { deleted: reservation, accommodationDeleted, deletedBudgetItemId: linkedBudget ? linkedBudget.id : null };
}
