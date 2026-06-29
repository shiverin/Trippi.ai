import { asyncDb } from '../db/asyncDatabase';
import { DayNote } from '../types';

export { verifyTripAccess } from './tripAccess';

export async function listNotes(dayId: string | number, tripId: string | number) {
  return asyncDb
    .prepare('SELECT * FROM day_notes WHERE day_id = ? AND trip_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(dayId, tripId);
}

export async function dayExists(dayId: string | number, tripId: string | number) {
  return asyncDb.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId);
}

export async function createNote(
  dayId: string | number,
  tripId: string | number,
  text: string,
  time?: string,
  icon?: string,
  sort_order?: number,
) {
  const result = await asyncDb
    .prepare('INSERT INTO day_notes (day_id, trip_id, text, time, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(dayId, tripId, text.trim(), time || null, icon || '\uD83D\uDCDD', sort_order ?? 9999);
  return asyncDb.prepare('SELECT * FROM day_notes WHERE id = ?').get(result.lastInsertRowid);
}

export async function getNote(id: string | number, dayId: string | number, tripId: string | number) {
  return asyncDb
    .prepare('SELECT * FROM day_notes WHERE id = ? AND day_id = ? AND trip_id = ?')
    .get<DayNote>(id, dayId, tripId);
}

export async function updateNote(
  id: string | number,
  current: DayNote,
  fields: { text?: string; time?: string; icon?: string; sort_order?: number },
) {
  await asyncDb.prepare('UPDATE day_notes SET text = ?, time = ?, icon = ?, sort_order = ? WHERE id = ?').run(
    fields.text !== undefined ? fields.text.trim() : current.text,
    fields.time !== undefined ? fields.time : current.time,
    fields.icon !== undefined ? fields.icon : current.icon,
    fields.sort_order !== undefined ? fields.sort_order : current.sort_order,
    id,
  );
  return asyncDb.prepare('SELECT * FROM day_notes WHERE id = ?').get(id);
}

export async function deleteNote(id: string | number) {
  await asyncDb.prepare('DELETE FROM day_notes WHERE id = ?').run(id);
}
