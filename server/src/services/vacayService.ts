import { asyncDb } from '../db/asyncDatabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VacayPlan {
  id: number;
  owner_id: number;
  block_weekends: number;
  holidays_enabled: number;
  holidays_region: string | null;
  company_holidays_enabled: number;
  carry_over_enabled: number;
}

export interface VacayUserYear {
  user_id: number;
  plan_id: number;
  year: number;
  vacation_days: number;
  carried_over: number;
}

export interface VacayUser {
  id: number;
  username: string;
  email: string;
}

export interface VacayPlanMember {
  id: number;
  plan_id: number;
  user_id: number;
  status: string;
  created_at?: string;
}

export interface Holiday {
  date: string;
  localName?: string;
  name?: string;
  global?: boolean;
  counties?: string[] | null;
}

export interface VacayHolidayCalendar {
  id: number;
  plan_id: number;
  region: string;
  label: string | null;
  color: string;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Holiday cache (shared in-process)
// ---------------------------------------------------------------------------

const holidayCache = new Map<string, { data: unknown; time: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Color palette for auto-assign
// ---------------------------------------------------------------------------

const COLORS = [
  '#6366f1',
  '#ec4899',
  '#14b8a6',
  '#8b5cf6',
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#06b6d4',
  '#f43f5e',
  '#a855f7',
  '#10b981',
  '#0ea5e9',
  '#64748b',
  '#be185d',
  '#0d9488',
];

function yearDateRange(year: number | string): [string, string] {
  const normalized = Number(year);
  const safeYear = Number.isInteger(normalized) && normalized > 0 ? normalized : new Date().getFullYear();
  return [`${safeYear}-01-01`, `${safeYear}-12-31`];
}

// ---------------------------------------------------------------------------
// Plan management
// ---------------------------------------------------------------------------

export async function getOwnPlan(userId: number): Promise<VacayPlan> {
  let plan = await asyncDb.prepare('SELECT * FROM vacay_plans WHERE owner_id = ?').get<VacayPlan>(userId);
  if (!plan) {
    await asyncDb.prepare('INSERT INTO vacay_plans (owner_id) VALUES (?)').run(userId);
    plan = (await asyncDb.prepare('SELECT * FROM vacay_plans WHERE owner_id = ?').get<VacayPlan>(userId))!;
    const yr = new Date().getFullYear();
    await asyncDb.prepare('INSERT OR IGNORE INTO vacay_years (plan_id, year) VALUES (?, ?)').run(plan.id, yr);
    await asyncDb
      .prepare(
        'INSERT OR IGNORE INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, 30, 0)',
      )
      .run(userId, plan.id, yr);
    await asyncDb
      .prepare('INSERT OR IGNORE INTO vacay_user_colors (user_id, plan_id, color) VALUES (?, ?, ?)')
      .run(userId, plan.id, '#6366f1');
  }
  return plan;
}

export async function getActivePlan(userId: number): Promise<VacayPlan> {
  const membership = await asyncDb
    .prepare(
      `
    SELECT plan_id FROM vacay_plan_members WHERE user_id = ? AND status = 'accepted'
  `,
    )
    .get<{ plan_id: number }>(userId);
  if (membership) {
    return (await asyncDb.prepare('SELECT * FROM vacay_plans WHERE id = ?').get<VacayPlan>(membership.plan_id))!;
  }
  return getOwnPlan(userId);
}

export async function getActivePlanId(userId: number): Promise<number> {
  return (await getActivePlan(userId)).id;
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function daysBetween(start: string, end: string): number {
  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  if (!startDate || !endDate) return 0;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
}

function addDays(value: string, offset: number): string | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function shiftOwnerEntriesForTripWindow(
  ownerId: number,
  oldStart: string,
  oldEnd: string,
  newStart: string,
): Promise<void> {
  const offset = daysBetween(oldStart, newStart);
  if (offset === 0) return;

  const plan = await getOwnPlan(ownerId);
  const entries = await asyncDb
    .prepare(
      `
        SELECT id, date FROM vacay_entries
        WHERE plan_id = ?
          AND user_id = ?
          AND date BETWEEN ? AND ?
        ORDER BY date ${offset > 0 ? 'DESC' : 'ASC'}
      `,
    )
    .all<{ id: number; date: string }>(plan.id, ownerId, oldStart, oldEnd);
  const update = asyncDb.prepare('UPDATE vacay_entries SET date = ? WHERE id = ?');
  const move = asyncDb.transaction(async (rows: typeof entries) => {
    for (const entry of rows) {
      const shifted = addDays(entry.date, offset);
      if (!shifted) continue;
      try {
        await update.run(shifted, entry.id);
      } catch {
        // Preserve SQLite UPDATE OR IGNORE behavior when the shifted date would
        // collide with an existing unique (user_id, plan_id, date) row.
      }
    }
  });
  await move(entries);
}

export async function getPlanUsers(planId: number): Promise<VacayUser[]> {
  const plan = await asyncDb.prepare('SELECT * FROM vacay_plans WHERE id = ?').get<VacayPlan>(planId);
  if (!plan) return [];
  const owner = (await asyncDb.prepare('SELECT id, username, email FROM users WHERE id = ?').get<VacayUser>(plan.owner_id))!;
  const members = await asyncDb
    .prepare(
      `
    SELECT u.id, u.username, u.email FROM vacay_plan_members m
    JOIN users u ON m.user_id = u.id
    WHERE m.plan_id = ? AND m.status = 'accepted'
  `,
    )
    .all<VacayUser>(planId);
  return [owner, ...members];
}

// ---------------------------------------------------------------------------
// WebSocket notifications
// ---------------------------------------------------------------------------

export async function notifyPlanUsers(planId: number, excludeSid: string | undefined, event = 'vacay:update'): Promise<void> {
  try {
    const { broadcastToUser } = require('../websocket');
    const plan = await asyncDb.prepare('SELECT owner_id FROM vacay_plans WHERE id = ?').get<{ owner_id: number }>(planId);
    if (!plan) return;
    const userIds = [plan.owner_id];
    const members = await asyncDb
      .prepare("SELECT user_id FROM vacay_plan_members WHERE plan_id = ? AND status = 'accepted'")
      .all<{ user_id: number }>(planId);
    members.forEach((m) => userIds.push(m.user_id));
    userIds.forEach((id) => broadcastToUser(id, { type: event }, excludeSid));
  } catch {
    /* websocket not available */
  }
}

// ---------------------------------------------------------------------------
// Holiday calendar helpers
// ---------------------------------------------------------------------------

export async function applyHolidayCalendars(planId: number): Promise<void> {
  const plan = await asyncDb
    .prepare('SELECT holidays_enabled FROM vacay_plans WHERE id = ?')
    .get<{ holidays_enabled: number }>(planId);
  if (!plan?.holidays_enabled) return;
  const calendars = await asyncDb
    .prepare('SELECT * FROM vacay_holiday_calendars WHERE plan_id = ? ORDER BY sort_order, id')
    .all<VacayHolidayCalendar>(planId);
  if (calendars.length === 0) return;
  const years = await asyncDb.prepare('SELECT year FROM vacay_years WHERE plan_id = ?').all<{ year: number }>(planId);
  for (const cal of calendars) {
    const country = cal.region.split('-')[0];
    const region = cal.region.includes('-') ? cal.region : null;
    for (const { year } of years) {
      try {
        const cacheKey = `${year}-${country}`;
        let holidays = holidayCache.get(cacheKey)?.data as Holiday[] | undefined;
        if (!holidays) {
          const resp = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
          holidays = (await resp.json()) as Holiday[];
          holidayCache.set(cacheKey, { data: holidays, time: Date.now() });
        }
        const hasRegions = holidays.some((h: Holiday) => h.counties && h.counties.length > 0);
        if (hasRegions && !region) continue;
        for (const h of holidays) {
          if (h.global || !h.counties || (region && h.counties.includes(region))) {
            await asyncDb.prepare('DELETE FROM vacay_entries WHERE plan_id = ? AND date = ?').run(planId, h.date);
            await asyncDb.prepare('DELETE FROM vacay_company_holidays WHERE plan_id = ? AND date = ?').run(planId, h.date);
          }
        }
      } catch {
        /* API error, skip */
      }
    }
  }
}

export async function migrateHolidayCalendars(planId: number, plan: VacayPlan): Promise<void> {
  const existing = await asyncDb.prepare('SELECT id FROM vacay_holiday_calendars WHERE plan_id = ?').get(planId);
  if (existing) return;
  if (plan.holidays_enabled && plan.holidays_region) {
    await asyncDb
      .prepare(
        'INSERT INTO vacay_holiday_calendars (plan_id, region, label, color, sort_order) VALUES (?, ?, NULL, ?, 0)',
      )
      .run(planId, plan.holidays_region, '#fecaca');
  }
}

// ---------------------------------------------------------------------------
// Plan settings
// ---------------------------------------------------------------------------

export interface UpdatePlanBody {
  block_weekends?: boolean;
  holidays_enabled?: boolean;
  holidays_region?: string;
  company_holidays_enabled?: boolean;
  carry_over_enabled?: boolean;
  weekend_days?: string;
  week_start?: number;
}

export async function updatePlan(planId: number, body: UpdatePlanBody, socketId: string | undefined) {
  const {
    block_weekends,
    holidays_enabled,
    holidays_region,
    company_holidays_enabled,
    carry_over_enabled,
    weekend_days,
    week_start,
  } = body;

  const updates: string[] = [];
  const params: (string | number)[] = [];
  if (block_weekends !== undefined) {
    updates.push('block_weekends = ?');
    params.push(block_weekends ? 1 : 0);
  }
  if (holidays_enabled !== undefined) {
    updates.push('holidays_enabled = ?');
    params.push(holidays_enabled ? 1 : 0);
  }
  if (holidays_region !== undefined) {
    updates.push('holidays_region = ?');
    params.push(holidays_region);
  }
  if (company_holidays_enabled !== undefined) {
    updates.push('company_holidays_enabled = ?');
    params.push(company_holidays_enabled ? 1 : 0);
  }
  if (carry_over_enabled !== undefined) {
    updates.push('carry_over_enabled = ?');
    params.push(carry_over_enabled ? 1 : 0);
  }
  if (weekend_days !== undefined) {
    updates.push('weekend_days = ?');
    params.push(String(weekend_days));
  }
  if (week_start !== undefined) {
    updates.push('week_start = ?');
    params.push(week_start === 0 ? 0 : 1);
  }

  if (updates.length > 0) {
    params.push(planId);
    await asyncDb.prepare(`UPDATE vacay_plans SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  if (company_holidays_enabled === true) {
    const companyDates = await asyncDb
      .prepare('SELECT date FROM vacay_company_holidays WHERE plan_id = ?')
      .all<{ date: string }>(planId);
    for (const { date } of companyDates) {
      await asyncDb.prepare('DELETE FROM vacay_entries WHERE plan_id = ? AND date = ?').run(planId, date);
    }
  }

  const updatedPlan = (await asyncDb.prepare('SELECT * FROM vacay_plans WHERE id = ?').get<VacayPlan>(planId))!;
  await migrateHolidayCalendars(planId, updatedPlan);
  await applyHolidayCalendars(planId);

  if (carry_over_enabled === false) {
    await asyncDb.prepare('UPDATE vacay_user_years SET carried_over = 0 WHERE plan_id = ?').run(planId);
  }

  if (carry_over_enabled === true) {
    const years = await asyncDb
      .prepare('SELECT year FROM vacay_years WHERE plan_id = ? ORDER BY year')
      .all<{ year: number }>(planId);
    const users = await getPlanUsers(planId);
    for (let i = 0; i < years.length - 1; i++) {
      const yr = years[i].year;
      const nextYr = years[i + 1].year;
      for (const u of users) {
        const used =
          (
            await asyncDb
              .prepare('SELECT COUNT(*) as count FROM vacay_entries WHERE user_id = ? AND plan_id = ? AND date LIKE ?')
              .get<{ count: number }>(u.id, planId, `${yr}-%`)
          )?.count ?? 0;
        const config = await asyncDb
          .prepare('SELECT * FROM vacay_user_years WHERE user_id = ? AND plan_id = ? AND year = ?')
          .get<VacayUserYear>(u.id, planId, yr);
        const total = (config ? config.vacation_days : 30) + (config ? config.carried_over : 0);
        const carry = Math.max(0, total - used);
        await asyncDb
          .prepare(
            `
          INSERT INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, 30, ?)
          ON CONFLICT(user_id, plan_id, year) DO UPDATE SET carried_over = ?
        `,
          )
          .run(u.id, planId, nextYr, carry, carry);
      }
    }
  }

  await notifyPlanUsers(planId, socketId, 'vacay:settings');

  const updated = (await asyncDb.prepare('SELECT * FROM vacay_plans WHERE id = ?').get<VacayPlan>(planId))!;
  const updatedCalendars = await asyncDb
    .prepare('SELECT * FROM vacay_holiday_calendars WHERE plan_id = ? ORDER BY sort_order, id')
    .all<VacayHolidayCalendar>(planId);
  return {
    plan: {
      ...updated,
      block_weekends: !!updated.block_weekends,
      holidays_enabled: !!updated.holidays_enabled,
      company_holidays_enabled: !!updated.company_holidays_enabled,
      carry_over_enabled: !!updated.carry_over_enabled,
      holiday_calendars: updatedCalendars,
    },
  };
}

// ---------------------------------------------------------------------------
// Holiday calendars CRUD
// ---------------------------------------------------------------------------

export async function addHolidayCalendar(
  planId: number,
  region: string,
  label: string | null,
  color: string | undefined,
  sortOrder: number | undefined,
  socketId: string | undefined,
) {
  const result = await asyncDb
    .prepare('INSERT INTO vacay_holiday_calendars (plan_id, region, label, color, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(planId, region, label || null, color || '#fecaca', sortOrder ?? 0);
  const cal = (await asyncDb
    .prepare('SELECT * FROM vacay_holiday_calendars WHERE id = ?')
    .get<VacayHolidayCalendar>(result.lastInsertRowid))!;
  await notifyPlanUsers(planId, socketId, 'vacay:settings');
  return cal;
}

export async function updateHolidayCalendar(
  calId: number,
  planId: number,
  body: { region?: string; label?: string | null; color?: string; sort_order?: number },
  socketId: string | undefined,
): Promise<VacayHolidayCalendar | null> {
  const cal = await asyncDb
    .prepare('SELECT * FROM vacay_holiday_calendars WHERE id = ? AND plan_id = ?')
    .get<VacayHolidayCalendar>(calId, planId);
  if (!cal) return null;
  const { region, label, color, sort_order } = body;
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (region !== undefined) {
    updates.push('region = ?');
    params.push(region);
  }
  if (label !== undefined) {
    updates.push('label = ?');
    params.push(label);
  }
  if (color !== undefined) {
    updates.push('color = ?');
    params.push(color);
  }
  if (sort_order !== undefined) {
    updates.push('sort_order = ?');
    params.push(sort_order);
  }
  if (updates.length > 0) {
    params.push(calId);
    await asyncDb.prepare(`UPDATE vacay_holiday_calendars SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  const updated = (await asyncDb
    .prepare('SELECT * FROM vacay_holiday_calendars WHERE id = ?')
    .get<VacayHolidayCalendar>(calId))!;
  await notifyPlanUsers(planId, socketId, 'vacay:settings');
  return updated;
}

export async function deleteHolidayCalendar(
  calId: number,
  planId: number,
  socketId: string | undefined,
): Promise<boolean> {
  const cal = await asyncDb
    .prepare('SELECT * FROM vacay_holiday_calendars WHERE id = ? AND plan_id = ?')
    .get(calId, planId);
  if (!cal) return false;
  await asyncDb.prepare('DELETE FROM vacay_holiday_calendars WHERE id = ?').run(calId);
  await notifyPlanUsers(planId, socketId, 'vacay:settings');
  return true;
}

// ---------------------------------------------------------------------------
// User colors
// ---------------------------------------------------------------------------

export async function setUserColor(
  userId: number,
  planId: number,
  color: string | undefined,
  socketId: string | undefined,
): Promise<void> {
  await asyncDb.prepare(
    `
    INSERT INTO vacay_user_colors (user_id, plan_id, color) VALUES (?, ?, ?)
    ON CONFLICT(user_id, plan_id) DO UPDATE SET color = excluded.color
  `,
  ).run(userId, planId, color || '#6366f1');
  await notifyPlanUsers(planId, socketId, 'vacay:update');
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function sendInvite(
  planId: number,
  inviterId: number,
  inviterUsername: string,
  inviterEmail: string,
  targetUserId: number,
): Promise<{ error?: string; status?: number }> {
  if (targetUserId === inviterId) return { error: 'Cannot invite yourself', status: 400 };

  const targetUser = await asyncDb.prepare('SELECT id, username FROM users WHERE id = ?').get(targetUserId);
  if (!targetUser) return { error: 'User not found', status: 404 };

  const existing = await asyncDb
    .prepare('SELECT id, status FROM vacay_plan_members WHERE plan_id = ? AND user_id = ?')
    .get<{ id: number; status: string }>(planId, targetUserId);
  if (existing) {
    if (existing.status === 'accepted') return { error: 'Already fused', status: 400 };
    if (existing.status === 'pending') return { error: 'Invite already pending', status: 400 };
  }

  const targetFusion = await asyncDb
    .prepare("SELECT id FROM vacay_plan_members WHERE user_id = ? AND status = 'accepted'")
    .get(targetUserId);
  if (targetFusion) return { error: 'User is already fused with another plan', status: 400 };

  await asyncDb
    .prepare('INSERT INTO vacay_plan_members (plan_id, user_id, status) VALUES (?, ?, ?)')
    .run(planId, targetUserId, 'pending');

  try {
    const { broadcastToUser } = require('../websocket');
    broadcastToUser(targetUserId, {
      type: 'vacay:invite',
      from: { id: inviterId, username: inviterUsername },
      planId,
    });
  } catch {
    /* websocket not available */
  }

  // Notify invited user
  import('../services/notificationService').then(({ send }) => {
    send({
      event: 'vacay_invite',
      actorId: inviterId,
      scope: 'user',
      targetId: targetUserId,
      params: { actor: inviterEmail, planId: String(planId) },
    }).catch(() => {});
  });

  return {};
}

export async function acceptInvite(
  userId: number,
  planId: number,
  socketId: string | undefined,
): Promise<{ error?: string; status?: number }> {
  const invite = await asyncDb
    .prepare("SELECT * FROM vacay_plan_members WHERE plan_id = ? AND user_id = ? AND status = 'pending'")
    .get<VacayPlanMember>(planId, userId);
  if (!invite) return { error: 'No pending invite', status: 404 };

  await asyncDb.prepare("UPDATE vacay_plan_members SET status = 'accepted' WHERE id = ?").run(invite.id);

  // Migrate data from user's own plan
  const ownPlan = await asyncDb.prepare('SELECT id FROM vacay_plans WHERE owner_id = ?').get<{ id: number }>(userId);
  if (ownPlan && ownPlan.id !== planId) {
    await asyncDb.prepare('UPDATE vacay_entries SET plan_id = ? WHERE plan_id = ? AND user_id = ?').run(
      planId,
      ownPlan.id,
      userId,
    );
    const ownYears = await asyncDb
      .prepare('SELECT * FROM vacay_user_years WHERE user_id = ? AND plan_id = ?')
      .all<VacayUserYear>(userId, ownPlan.id);
    for (const y of ownYears) {
      await asyncDb
        .prepare(
          'INSERT OR IGNORE INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, ?, ?)',
        )
        .run(userId, planId, y.year, y.vacation_days, y.carried_over);
    }
    const colorRow = await asyncDb
      .prepare('SELECT color FROM vacay_user_colors WHERE user_id = ? AND plan_id = ?')
      .get<{ color: string }>(userId, ownPlan.id);
    if (colorRow) {
      await asyncDb
        .prepare('INSERT OR IGNORE INTO vacay_user_colors (user_id, plan_id, color) VALUES (?, ?, ?)')
        .run(userId, planId, colorRow.color);
    }
  }

  // Auto-assign unique color
  const existingColors = (
    await asyncDb
      .prepare('SELECT color FROM vacay_user_colors WHERE plan_id = ? AND user_id != ?')
      .all<{ color: string }>(planId, userId)
  ).map((r) => r.color);
  const myColor = await asyncDb
    .prepare('SELECT color FROM vacay_user_colors WHERE user_id = ? AND plan_id = ?')
    .get<{ color: string }>(userId, planId);
  const effectiveColor = myColor?.color || '#6366f1';
  if (existingColors.includes(effectiveColor)) {
    const available = COLORS.find((c) => !existingColors.includes(c));
    if (available) {
      await asyncDb
        .prepare(
          `INSERT INTO vacay_user_colors (user_id, plan_id, color) VALUES (?, ?, ?)
        ON CONFLICT(user_id, plan_id) DO UPDATE SET color = excluded.color`,
        )
        .run(userId, planId, available);
    }
  } else if (!myColor) {
    await asyncDb
      .prepare('INSERT OR IGNORE INTO vacay_user_colors (user_id, plan_id, color) VALUES (?, ?, ?)')
      .run(userId, planId, effectiveColor);
  }

  // Ensure user has rows for all plan years
  const targetYears = await asyncDb.prepare('SELECT year FROM vacay_years WHERE plan_id = ?').all<{ year: number }>(planId);
  for (const y of targetYears) {
    await asyncDb
      .prepare(
        'INSERT OR IGNORE INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, 30, 0)',
      )
      .run(userId, planId, y.year);
  }

  await notifyPlanUsers(planId, socketId, 'vacay:accepted');
  return {};
}

export async function declineInvite(userId: number, planId: number, socketId: string | undefined): Promise<void> {
  await asyncDb
    .prepare("DELETE FROM vacay_plan_members WHERE plan_id = ? AND user_id = ? AND status = 'pending'")
    .run(planId, userId);
  await notifyPlanUsers(planId, socketId, 'vacay:declined');
}

export async function cancelInvite(planId: number, targetUserId: number): Promise<void> {
  await asyncDb
    .prepare("DELETE FROM vacay_plan_members WHERE plan_id = ? AND user_id = ? AND status = 'pending'")
    .run(planId, targetUserId);

  try {
    const { broadcastToUser } = require('../websocket');
    broadcastToUser(targetUserId, { type: 'vacay:cancelled' });
  } catch {
    /* */
  }
}

// ---------------------------------------------------------------------------
// Plan dissolution
// ---------------------------------------------------------------------------

export async function dissolvePlan(userId: number, socketId: string | undefined): Promise<void> {
  const plan = await getActivePlan(userId);
  const isOwnerFlag = plan.owner_id === userId;

  const allUserIds = (await getPlanUsers(plan.id)).map((u) => u.id);
  const companyHolidays = await asyncDb
    .prepare('SELECT date, note FROM vacay_company_holidays WHERE plan_id = ?')
    .all<{ date: string; note: string }>(plan.id);

  if (isOwnerFlag) {
    const members = await asyncDb
      .prepare("SELECT user_id FROM vacay_plan_members WHERE plan_id = ? AND status = 'accepted'")
      .all<{ user_id: number }>(plan.id);
    for (const m of members) {
      const memberPlan = await getOwnPlan(m.user_id);
      await asyncDb.prepare('UPDATE vacay_entries SET plan_id = ? WHERE plan_id = ? AND user_id = ?').run(
        memberPlan.id,
        plan.id,
        m.user_id,
      );
      for (const ch of companyHolidays) {
        await asyncDb
          .prepare('INSERT OR IGNORE INTO vacay_company_holidays (plan_id, date, note) VALUES (?, ?, ?)')
          .run(memberPlan.id, ch.date, ch.note);
      }
    }
    await asyncDb.prepare('DELETE FROM vacay_plan_members WHERE plan_id = ?').run(plan.id);
  } else {
    const ownPlan = await getOwnPlan(userId);
    await asyncDb.prepare('UPDATE vacay_entries SET plan_id = ? WHERE plan_id = ? AND user_id = ?').run(
      ownPlan.id,
      plan.id,
      userId,
    );
    for (const ch of companyHolidays) {
      await asyncDb
        .prepare('INSERT OR IGNORE INTO vacay_company_holidays (plan_id, date, note) VALUES (?, ?, ?)')
        .run(ownPlan.id, ch.date, ch.note);
    }
    await asyncDb.prepare('DELETE FROM vacay_plan_members WHERE plan_id = ? AND user_id = ?').run(plan.id, userId);
  }

  try {
    const { broadcastToUser } = require('../websocket');
    allUserIds.filter((id) => id !== userId).forEach((id) => broadcastToUser(id, { type: 'vacay:dissolved' }));
  } catch {
    /* */
  }
}

// ---------------------------------------------------------------------------
// Available users
// ---------------------------------------------------------------------------

export async function getAvailableUsers(userId: number, planId: number) {
  return asyncDb
    .prepare(
      `
    SELECT u.id, u.username, u.email FROM users u
    WHERE u.id != ?
    AND u.id NOT IN (SELECT user_id FROM vacay_plan_members WHERE plan_id = ?)
    AND u.id NOT IN (SELECT user_id FROM vacay_plan_members WHERE status = 'accepted')
    AND u.id NOT IN (SELECT owner_id FROM vacay_plans WHERE id IN (
      SELECT plan_id FROM vacay_plan_members WHERE status = 'accepted'
    ))
    ORDER BY u.username
  `,
    )
    .all(userId, planId);
}

// ---------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------

export async function listYears(planId: number): Promise<number[]> {
  const rows = await asyncDb
    .prepare('SELECT year FROM vacay_years WHERE plan_id = ? ORDER BY year')
    .all<{ year: number }>(planId);
  return rows.map((y) => y.year);
}

export async function addYear(planId: number, year: number, socketId: string | undefined): Promise<number[]> {
  try {
    await asyncDb.prepare('INSERT INTO vacay_years (plan_id, year) VALUES (?, ?)').run(planId, year);
    const plan = await asyncDb.prepare('SELECT * FROM vacay_plans WHERE id = ?').get<VacayPlan>(planId);
    const carryOverEnabled = plan ? !!plan.carry_over_enabled : true;
    const users = await getPlanUsers(planId);
    for (const u of users) {
      let carriedOver = 0;
      if (carryOverEnabled) {
        const prevConfig = await asyncDb
          .prepare('SELECT * FROM vacay_user_years WHERE user_id = ? AND plan_id = ? AND year = ?')
          .get<VacayUserYear>(u.id, planId, year - 1);
        if (prevConfig) {
          const used =
            (
              await asyncDb
                .prepare('SELECT COUNT(*) as count FROM vacay_entries WHERE user_id = ? AND plan_id = ? AND date LIKE ?')
                .get<{ count: number }>(u.id, planId, `${year - 1}-%`)
            )?.count ?? 0;
          const total = prevConfig.vacation_days + prevConfig.carried_over;
          carriedOver = Math.max(0, total - used);
        }
      }
      await asyncDb
        .prepare(
          'INSERT OR IGNORE INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, 30, ?)',
        )
        .run(u.id, planId, year, carriedOver);
    }
  } catch {
    /* year already exists */
  }
  await notifyPlanUsers(planId, socketId, 'vacay:settings');
  return listYears(planId);
}

export async function deleteYear(planId: number, year: number, socketId: string | undefined): Promise<number[]> {
  await asyncDb.prepare('DELETE FROM vacay_years WHERE plan_id = ? AND year = ?').run(planId, year);
  await asyncDb.prepare('DELETE FROM vacay_entries WHERE plan_id = ? AND date LIKE ?').run(planId, `${year}-%`);
  await asyncDb.prepare('DELETE FROM vacay_company_holidays WHERE plan_id = ? AND date LIKE ?').run(planId, `${year}-%`);
  await asyncDb.prepare('DELETE FROM vacay_user_years WHERE plan_id = ? AND year = ?').run(planId, year);

  // Recalculate carry-over for year+1 if it exists, since its previous year has changed
  const nextYearExists = await asyncDb
    .prepare('SELECT id FROM vacay_years WHERE plan_id = ? AND year = ?')
    .get(planId, year + 1);
  if (nextYearExists) {
    const plan = await asyncDb.prepare('SELECT * FROM vacay_plans WHERE id = ?').get<VacayPlan>(planId);
    const carryOverEnabled = plan ? !!plan.carry_over_enabled : true;
    const users = await getPlanUsers(planId);
    const prevYear = await asyncDb
      .prepare('SELECT year FROM vacay_years WHERE plan_id = ? AND year < ? ORDER BY year DESC LIMIT 1')
      .get<{ year: number }>(planId, year + 1);

    for (const u of users) {
      let carry = 0;
      if (carryOverEnabled && prevYear) {
        const prevConfig = await asyncDb
          .prepare('SELECT * FROM vacay_user_years WHERE user_id = ? AND plan_id = ? AND year = ?')
          .get<VacayUserYear>(u.id, planId, prevYear.year);
        if (prevConfig) {
          const used =
            (
              await asyncDb
                .prepare('SELECT COUNT(*) as count FROM vacay_entries WHERE user_id = ? AND plan_id = ? AND date LIKE ?')
                .get<{ count: number }>(u.id, planId, `${prevYear.year}-%`)
            )?.count ?? 0;
          const total = prevConfig.vacation_days + prevConfig.carried_over;
          carry = Math.max(0, total - used);
        }
      }
      await asyncDb
        .prepare('UPDATE vacay_user_years SET carried_over = ? WHERE user_id = ? AND plan_id = ? AND year = ?')
        .run(carry, u.id, planId, year + 1);
    }
  }

  await notifyPlanUsers(planId, socketId, 'vacay:settings');
  return listYears(planId);
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function getEntries(planId: number, year: string) {
  const [start, end] = yearDateRange(year);
  const entries = await asyncDb
    .prepare(
      `
    SELECT e.*, u.username as person_name, COALESCE(c.color, '#6366f1') as person_color
    FROM vacay_entries e
    JOIN users u ON e.user_id = u.id
    LEFT JOIN vacay_user_colors c ON c.user_id = e.user_id AND c.plan_id = e.plan_id
    WHERE e.plan_id = ? AND e.date BETWEEN ? AND ?
  `,
    )
    .all(planId, start, end);
  const companyHolidays = await asyncDb
    .prepare('SELECT * FROM vacay_company_holidays WHERE plan_id = ? AND date BETWEEN ? AND ?')
    .all(planId, start, end);
  return { entries, companyHolidays };
}

export async function toggleEntry(
  userId: number,
  planId: number,
  date: string,
  socketId: string | undefined,
): Promise<{ action: string }> {
  const existing = await asyncDb
    .prepare('SELECT id FROM vacay_entries WHERE user_id = ? AND date = ? AND plan_id = ?')
    .get<{ id: number }>(userId, date, planId);
  if (existing) {
    await asyncDb.prepare('DELETE FROM vacay_entries WHERE id = ?').run(existing.id);
    await notifyPlanUsers(planId, socketId);
    return { action: 'removed' };
  } else {
    await asyncDb
      .prepare('INSERT INTO vacay_entries (plan_id, user_id, date, note) VALUES (?, ?, ?, ?)')
      .run(planId, userId, date, '');
    await notifyPlanUsers(planId, socketId);
    return { action: 'added' };
  }
}

export async function toggleCompanyHoliday(
  planId: number,
  date: string,
  note: string | undefined,
  socketId: string | undefined,
): Promise<{ action: string }> {
  const existing = await asyncDb
    .prepare('SELECT id FROM vacay_company_holidays WHERE plan_id = ? AND date = ?')
    .get<{ id: number }>(planId, date);
  if (existing) {
    await asyncDb.prepare('DELETE FROM vacay_company_holidays WHERE id = ?').run(existing.id);
    await notifyPlanUsers(planId, socketId);
    return { action: 'removed' };
  } else {
    await asyncDb
      .prepare('INSERT INTO vacay_company_holidays (plan_id, date, note) VALUES (?, ?, ?)')
      .run(planId, date, note || '');
    await asyncDb.prepare('DELETE FROM vacay_entries WHERE plan_id = ? AND date = ?').run(planId, date);
    await notifyPlanUsers(planId, socketId);
    return { action: 'added' };
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStats(planId: number, year: number) {
  const [start, end] = yearDateRange(year);
  const [plan, users] = await Promise.all([
    asyncDb.prepare('SELECT * FROM vacay_plans WHERE id = ?').get<VacayPlan>(planId),
    getPlanUsers(planId),
  ]);
  const carryOverEnabled = plan ? !!plan.carry_over_enabled : true;
  if (users.length === 0) return [];

  const userIds = users.map((u) => Number(u.id));
  const placeholders = userIds.map(() => '?').join(',');
  const [usedRows, configRows, colorRows, nextYearExists] = await Promise.all([
    asyncDb
      .prepare(
        `
        SELECT user_id, COUNT(*) as count
        FROM vacay_entries
        WHERE plan_id = ? AND date BETWEEN ? AND ? AND user_id IN (${placeholders})
        GROUP BY user_id
      `,
      )
      .all<{ user_id: number; count: number }>(planId, start, end, ...userIds),
    asyncDb
      .prepare(`SELECT * FROM vacay_user_years WHERE plan_id = ? AND year = ? AND user_id IN (${placeholders})`)
      .all<VacayUserYear>(planId, year, ...userIds),
    asyncDb
      .prepare(`SELECT user_id, color FROM vacay_user_colors WHERE plan_id = ? AND user_id IN (${placeholders})`)
      .all<{ user_id: number; color: string }>(planId, ...userIds),
    asyncDb.prepare('SELECT id FROM vacay_years WHERE plan_id = ? AND year = ?').get(planId, year + 1),
  ]);
  const usedByUser = new Map(usedRows.map((row) => [Number(row.user_id), Number(row.count ?? 0)]));
  const configByUser = new Map(configRows.map((row) => [Number(row.user_id), row]));
  const colorByUser = new Map(colorRows.map((row) => [Number(row.user_id), row.color]));
  const upsertCarry = asyncDb.prepare(
    `
    INSERT INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, 30, ?)
    ON CONFLICT(user_id, plan_id, year) DO UPDATE SET carried_over = ?
  `,
  );
  const stats = [];
  for (const u of users) {
    const used = usedByUser.get(Number(u.id)) ?? 0;
    const config = configByUser.get(Number(u.id));
    const vacationDays = config ? config.vacation_days : 30;
    const carriedOver = carryOverEnabled ? (config ? config.carried_over : 0) : 0;
    const total = vacationDays + carriedOver;
    const remaining = total - used;

    if (nextYearExists && carryOverEnabled) {
      const carry = Math.max(0, remaining);
      await upsertCarry.run(u.id, planId, year + 1, carry, carry);
    }

    stats.push({
      user_id: u.id,
      person_name: u.username,
      person_color: colorByUser.get(Number(u.id)) || '#6366f1',
      year,
      vacation_days: vacationDays,
      carried_over: carriedOver,
      total_available: total,
      used,
      remaining,
    });
  }
  return stats;
}

export async function updateStats(
  userId: number,
  planId: number,
  year: number,
  vacationDays: number,
  socketId: string | undefined,
): Promise<void> {
  await asyncDb.prepare(
    `
    INSERT INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(user_id, plan_id, year) DO UPDATE SET vacation_days = excluded.vacation_days
  `,
  ).run(userId, planId, year, vacationDays);
  await notifyPlanUsers(planId, socketId);
}

// ---------------------------------------------------------------------------
// GET /plan composite
// ---------------------------------------------------------------------------

export async function getPlanData(userId: number) {
  const plan = await getActivePlan(userId);
  const activePlanId = plan.id;

  const [planUsers, pendingInvites, incomingInvites, holidayCalendars] = await Promise.all([
    getPlanUsers(activePlanId),
    asyncDb
      .prepare(
        `
    SELECT m.id, m.user_id, u.username, u.email, m.created_at
    FROM vacay_plan_members m JOIN users u ON m.user_id = u.id
    WHERE m.plan_id = ? AND m.status = 'pending'
  `,
      )
      .all(activePlanId),
    asyncDb
      .prepare(
        `
    SELECT m.id, m.plan_id, u.username, u.email, m.created_at
    FROM vacay_plan_members m
    JOIN vacay_plans p ON m.plan_id = p.id
    JOIN users u ON p.owner_id = u.id
    WHERE m.user_id = ? AND m.status = 'pending'
  `,
      )
      .all(userId),
    asyncDb
      .prepare('SELECT * FROM vacay_holiday_calendars WHERE plan_id = ? ORDER BY sort_order, id')
      .all<VacayHolidayCalendar>(activePlanId),
  ]);

  const userIds = planUsers.map((u) => Number(u.id));
  const colorRows =
    userIds.length > 0
      ? await asyncDb
          .prepare(
            `SELECT user_id, color FROM vacay_user_colors WHERE plan_id = ? AND user_id IN (${userIds
              .map(() => '?')
              .join(',')})`,
          )
          .all<{ user_id: number; color: string }>(activePlanId, ...userIds)
      : [];
  const colorByUser = new Map(colorRows.map((row) => [Number(row.user_id), row.color]));
  const users = planUsers.map((u) => ({ ...u, color: colorByUser.get(Number(u.id)) || '#6366f1' }));

  return {
    plan: {
      ...plan,
      block_weekends: !!plan.block_weekends,
      holidays_enabled: !!plan.holidays_enabled,
      company_holidays_enabled: !!plan.company_holidays_enabled,
      carry_over_enabled: !!plan.carry_over_enabled,
      holiday_calendars: holidayCalendars,
    },
    users,
    pendingInvites,
    incomingInvites,
    isOwner: plan.owner_id === userId,
    isFused: users.length > 1,
  };
}

export async function getBootstrapData(userId: number, year: number) {
  const planData = await getPlanData(userId);
  const planId = Number(planData.plan.id);
  const [years, entriesData, stats] = await Promise.all([
    listYears(planId),
    getEntries(planId, String(year)),
    getStats(planId, year),
  ]);
  return {
    ...planData,
    years,
    entries: entriesData.entries,
    companyHolidays: entriesData.companyHolidays,
    holidays: [],
    stats,
  };
}

// ---------------------------------------------------------------------------
// Holidays (nager.at proxy with cache)
// ---------------------------------------------------------------------------

export async function getCountries(): Promise<{ data?: unknown; error?: string }> {
  const cacheKey = 'countries';
  const cached = holidayCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) return { data: cached.data };
  try {
    const resp = await fetch('https://date.nager.at/api/v3/AvailableCountries');
    const data = await resp.json();
    holidayCache.set(cacheKey, { data, time: Date.now() });
    return { data };
  } catch {
    return { error: 'Failed to fetch countries' };
  }
}

export async function getHolidays(year: string, country: string): Promise<{ data?: unknown; error?: string }> {
  const cacheKey = `${year}-${country}`;
  const cached = holidayCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) return { data: cached.data };
  try {
    const resp = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
    const data = await resp.json();
    holidayCache.set(cacheKey, { data, time: Date.now() });
    return { data };
  } catch {
    return { error: 'Failed to fetch holidays' };
  }
}
