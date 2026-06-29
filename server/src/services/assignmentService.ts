import { asyncDb } from '../db/asyncDatabase';
import { AssignmentRow, DayAssignment } from '../types';
import {
  loadTagsByPlaceIdsAsync,
  loadParticipantsByAssignmentIdsAsync,
  formatAssignmentWithPlace,
} from './queryHelpers';

export async function getAssignmentWithPlace(assignmentId: number | bigint | string) {
  const a = await asyncDb
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
    WHERE da.id = ?
  `,
    )
    .get<AssignmentRow>(assignmentId);

  if (!a) return null;

  const tags = await asyncDb
    .prepare(
      `
    SELECT t.* FROM tags t
    JOIN place_tags pt ON t.id = pt.tag_id
    WHERE pt.place_id = ?
  `,
    )
    .all(a.place_id);

  const participants = await asyncDb
    .prepare(
      `
    SELECT ap.user_id, u.username, u.avatar
    FROM assignment_participants ap
    JOIN users u ON ap.user_id = u.id
    WHERE ap.assignment_id = ?
  `,
    )
    .all(a.id);

  return {
    id: a.id,
    day_id: a.day_id,
    place_id: a.place_id,
    order_index: a.order_index,
    notes: a.notes,
    assignment_time: a.assignment_time ?? null,
    assignment_end_time: a.assignment_end_time ?? null,
    participants,
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
      tags,
    },
  };
}

export async function listDayAssignments(dayId: string | number) {
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

  const placeIds = [...new Set(assignments.map((a) => a.place_id))];
  const tagsByPlaceId = await loadTagsByPlaceIdsAsync(placeIds, { compact: true });

  const assignmentIds = assignments.map((a) => a.id);
  const participantsByAssignment = await loadParticipantsByAssignmentIdsAsync(assignmentIds);

  return assignments.map((a) => {
    return formatAssignmentWithPlace(a, tagsByPlaceId[a.place_id] || [], participantsByAssignment[a.id] || []);
  });
}

export async function dayExists(dayId: string | number, tripId: string | number) {
  return !!(await asyncDb.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId));
}

export async function placeExists(placeId: string | number, tripId: string | number) {
  return !!(await asyncDb.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(placeId, tripId));
}

export async function createAssignment(
  dayId: string | number,
  placeId: string | number,
  notes: string | null,
  options: {
    assignment_time?: string | null;
    assignment_end_time?: string | null;
    mcp_import_batch_id?: string | null;
  } = {},
) {
  const maxOrder = await asyncDb
    .prepare('SELECT MAX(order_index) as max FROM day_assignments WHERE day_id = ?')
    .get<{ max: number | null }>(dayId);
  const orderIndex = (maxOrder?.max !== null && maxOrder?.max !== undefined ? maxOrder.max : -1) + 1;

  const result = await asyncDb
    .prepare(
      `INSERT INTO day_assignments
        (day_id, place_id, order_index, notes, assignment_time, assignment_end_time, mcp_import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dayId,
      placeId,
      orderIndex,
      notes || null,
      options.assignment_time ?? null,
      options.assignment_end_time ?? null,
      options.mcp_import_batch_id ?? null,
    );

  return getAssignmentWithPlace(result.lastInsertRowid);
}

export async function assignmentExistsInDay(id: string | number, dayId: string | number, tripId: string | number) {
  return !!(await asyncDb
    .prepare(
      'SELECT da.id FROM day_assignments da JOIN days d ON da.day_id = d.id WHERE da.id = ? AND da.day_id = ? AND d.trip_id = ?',
    )
    .get(id, dayId, tripId));
}

export async function deleteAssignment(id: string | number) {
  await asyncDb.prepare('DELETE FROM day_assignments WHERE id = ?').run(id);
}

export async function reorderAssignments(dayId: string | number, orderedIds: number[]) {
  const update = asyncDb.prepare('UPDATE day_assignments SET order_index = ? WHERE id = ? AND day_id = ?');
  await asyncDb.transaction(async () => {
    for (const [index, id] of orderedIds.entries()) {
      await update.run(index, id, dayId);
    }
  })();
}

export async function getAssignmentForTrip(id: string | number, tripId: string | number) {
  return asyncDb
    .prepare(
      `
    SELECT da.* FROM day_assignments da
    JOIN days d ON da.day_id = d.id
    WHERE da.id = ? AND d.trip_id = ?
  `,
    )
    .get<DayAssignment>(id, tripId);
}

export async function moveAssignment(id: string | number, newDayId: string | number, orderIndex: number, oldDayId: number) {
  await asyncDb
    .prepare('UPDATE day_assignments SET day_id = ?, order_index = ? WHERE id = ?')
    .run(newDayId, orderIndex || 0, id);
  const updated = await getAssignmentWithPlace(Number(id));
  return { assignment: updated, oldDayId };
}

export async function getParticipants(assignmentId: string | number) {
  return asyncDb
    .prepare(
      `
    SELECT ap.user_id, u.username, u.avatar
    FROM assignment_participants ap
    JOIN users u ON ap.user_id = u.id
    WHERE ap.assignment_id = ?
  `,
    )
    .all(assignmentId);
}

export async function updateTime(id: string | number, placeTime: string | null, endTime: string | null) {
  await asyncDb.prepare('UPDATE day_assignments SET assignment_time = ?, assignment_end_time = ? WHERE id = ?').run(
    placeTime ?? null,
    endTime ?? null,
    id,
  );

  // Auto-sort: reorder timed assignments chronologically within the day
  if (placeTime) {
    const assignment = await asyncDb.prepare('SELECT day_id FROM day_assignments WHERE id = ?').get<{ day_id: number }>(
      id,
    );
    if (assignment) {
      const dayAssignments = await asyncDb
        .prepare(
          `
        SELECT da.id, COALESCE(da.assignment_time, p.place_time) as effective_time
        FROM day_assignments da
        JOIN places p ON da.place_id = p.id
        WHERE da.day_id = ?
        ORDER BY da.order_index ASC
      `,
        )
        .all<{ id: number; effective_time: string | null }>(assignment.day_id);

      // Separate timed and untimed, sort timed by time
      const timed = dayAssignments
        .filter((a) => a.effective_time)
        .sort((a, b) => {
          const ta = a.effective_time!.includes(':') ? a.effective_time! : '99:99';
          const tb = b.effective_time!.includes(':') ? b.effective_time! : '99:99';
          return ta.localeCompare(tb);
        });
      const untimed = dayAssignments.filter((a) => !a.effective_time);

      // Interleave: timed in chronological order, untimed keep relative position
      const reordered = [...timed, ...untimed];
      const update = asyncDb.prepare('UPDATE day_assignments SET order_index = ? WHERE id = ?');
      for (const [i, a] of reordered.entries()) await update.run(i, a.id);
    }
  }

  return getAssignmentWithPlace(Number(id));
}

export async function setParticipants(assignmentId: string | number, userIds: number[]) {
  await asyncDb.prepare('DELETE FROM assignment_participants WHERE assignment_id = ?').run(assignmentId);
  if (userIds.length > 0) {
    const insert = asyncDb.prepare('INSERT OR IGNORE INTO assignment_participants (assignment_id, user_id) VALUES (?, ?)');
    for (const userId of userIds) await insert.run(assignmentId, userId);
  }

  return asyncDb
    .prepare(
      `
    SELECT ap.user_id, u.username, u.avatar
    FROM assignment_participants ap
    JOIN users u ON ap.user_id = u.id
    WHERE ap.assignment_id = ?
  `,
    )
    .all(assignmentId);
}
