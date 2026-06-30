import { asyncDb, canAccessTripAsync } from '../../db/asyncDatabase';
import type { AgentJob } from '../../services/agentJobQueue';
import {
  enqueuePriceWatchJob,
  type BookingIntentWatchStatus,
  type PriceWatchJobPayload,
} from '../../services/bookingPriceWatch';
import { checkPermissionAsync } from '../../services/permissions';
import type { User } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

const STATUSES = ['draft', 'watching', 'options_ready', 'voting', 'approved', 'booked', 'archived'] as const;
const STATUS_SET = new Set<string>(STATUSES);
const JSON_FIELDS = ['dates', 'party_constraints', 'budget', 'preferences'] as const;

export type BookingIntentStatus = (typeof STATUSES)[number];

export interface BookingIntentInput {
  type?: unknown;
  dates?: unknown;
  origin?: unknown;
  destination?: unknown;
  party_constraints?: unknown;
  budget?: unknown;
  preferences?: unknown;
  status?: unknown;
}

interface BookingIntentRow {
  id: number;
  trip_id: number;
  created_by: number | null;
  type: string;
  dates: string;
  origin: string | null;
  destination: string | null;
  party_constraints: string;
  budget: string;
  preferences: string;
  status: BookingIntentStatus;
  watch_status: BookingIntentWatchStatus;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export class BookingIntentValidationError extends Error {}

export interface BookingIntentPriceWatchJob {
  id: number;
  type: string;
  status: string;
  idempotency_key: string | null;
  next_run_at: string;
  provider: string | null;
  provider_mode: string | null;
}

function hasOwn(data: BookingIntentInput, key: keyof BookingIntentInput): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function asOptionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BookingIntentValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BookingIntentValidationError(`${field} must be ${max} characters or less`);
  return trimmed || null;
}

function asRequiredString(value: unknown, field: string, max: number): string {
  const trimmed = asOptionalString(value, field, max);
  if (!trimmed) throw new BookingIntentValidationError(`${field} is required`);
  return trimmed;
}

function asStatus(value: unknown): BookingIntentStatus {
  if (value === undefined || value === null || value === '') return 'draft';
  if (typeof value !== 'string' || !STATUS_SET.has(value)) {
    throw new BookingIntentValidationError(`status must be one of: ${STATUSES.join(', ')}`);
  }
  return value as BookingIntentStatus;
}

function asJsonObject(value: unknown, field: string): string {
  const normalized = value === undefined || value === null ? {} : value;
  if (typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new BookingIntentValidationError(`${field} must be an object`);
  }
  const json = JSON.stringify(normalized);
  if (json.length > 20000) {
    throw new BookingIntentValidationError(`${field} must be 20000 characters or less`);
  }
  return json;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toBookingIntent(row: BookingIntentRow) {
  return {
    id: row.id,
    trip_id: row.trip_id,
    created_by: row.created_by,
    type: row.type,
    dates: parseJsonObject(row.dates),
    origin: row.origin,
    destination: row.destination,
    party_constraints: parseJsonObject(row.party_constraints),
    budget: parseJsonObject(row.budget),
    preferences: parseJsonObject(row.preferences),
    status: row.status,
    watch_status: row.watch_status,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPriceWatchJob(job: AgentJob<PriceWatchJobPayload>): BookingIntentPriceWatchJob {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    idempotency_key: job.idempotencyKey,
    next_run_at: job.nextRunAt,
    provider: job.payload.provider ?? null,
    provider_mode: job.payload.providerMode ?? null,
  };
}

type TripAccess = NonNullable<Awaited<ReturnType<typeof canAccessTripAsync>>>;

@Injectable()
export class BookingIntentsService {
  readonly statuses = STATUSES;

  async verifyTripAccess(tripId: string, userId: number): Promise<TripAccess | undefined> {
    return canAccessTripAsync(tripId, userId);
  }

  canEdit(trip: TripAccess, user: User): Promise<boolean> {
    return checkPermissionAsync('reservation_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  async list(tripId: string, status?: unknown) {
    if (status !== undefined) {
      const parsedStatus = asStatus(status);
      const rows = await asyncDb
        .prepare(
          `
          SELECT * FROM booking_intents
          WHERE trip_id = ? AND status = ?
          ORDER BY updated_at DESC, id DESC
        `,
        )
        .all<BookingIntentRow>(tripId, parsedStatus);
      return rows.map(toBookingIntent);
    }

    const rows = await asyncDb
      .prepare(
        `
        SELECT * FROM booking_intents
        WHERE trip_id = ?
        ORDER BY updated_at DESC, id DESC
      `,
      )
      .all<BookingIntentRow>(tripId);
    return rows.map(toBookingIntent);
  }

  async create(tripId: string, userId: number, data: BookingIntentInput) {
    const type = asRequiredString(data.type, 'type', 64);
    const status = asStatus(data.status);
    const origin = asOptionalString(data.origin, 'origin', 500);
    const destination = asOptionalString(data.destination, 'destination', 500);
    const json = Object.fromEntries(JSON_FIELDS.map((field) => [field, asJsonObject(data[field], field)])) as Record<
      (typeof JSON_FIELDS)[number],
      string
    >;

    const result = await asyncDb
      .prepare(
        `
        INSERT INTO booking_intents
          (trip_id, created_by, type, dates, origin, destination, party_constraints, budget, preferences, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        tripId,
        userId,
        type,
        json.dates,
        origin,
        destination,
        json.party_constraints,
        json.budget,
        json.preferences,
        status,
      );

    return this.getById(tripId, Number(result.lastInsertRowid));
  }

  async update(tripId: string, id: string, data: BookingIntentInput) {
    const existing = await this.getRow(tripId, id);
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(data, 'type')) {
      sets.push('type = ?');
      values.push(asRequiredString(data.type, 'type', 64));
    }
    if (hasOwn(data, 'origin')) {
      sets.push('origin = ?');
      values.push(asOptionalString(data.origin, 'origin', 500));
    }
    if (hasOwn(data, 'destination')) {
      sets.push('destination = ?');
      values.push(asOptionalString(data.destination, 'destination', 500));
    }
    if (hasOwn(data, 'status')) {
      sets.push('status = ?');
      values.push(asStatus(data.status));
    }
    for (const field of JSON_FIELDS) {
      if (hasOwn(data, field)) {
        sets.push(`${field} = ?`);
        values.push(asJsonObject(data[field], field));
      }
    }

    if (sets.length === 0) return toBookingIntent(existing);

    values.push(tripId, id);
    await asyncDb
      .prepare(
        `
        UPDATE booking_intents
        SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE trip_id = ? AND id = ?
      `,
      )
      .run(...values);

    return this.getById(tripId, id);
  }

  async startWatch(tripId: string, id: string) {
    const start = asyncDb.transaction(async () => {
      const existing = await this.getRow(tripId, id);
      if (!existing) return null;
      if (existing.status === 'archived') {
        throw new BookingIntentValidationError('archived booking intents cannot be watched');
      }

      await asyncDb
        .prepare(
          `
          UPDATE booking_intents
          SET status = 'watching',
              watch_status = 'queued',
              updated_at = CURRENT_TIMESTAMP
          WHERE trip_id = ? AND id = ?
        `,
        )
        .run(tripId, id);

      const job = await enqueuePriceWatchJob({
        tripId: Number(existing.trip_id),
        bookingIntentId: Number(existing.id),
      });
      const bookingIntent = await this.getById(tripId, id);

      return bookingIntent
        ? {
            bookingIntent,
            agentJob: toPriceWatchJob(job),
          }
        : null;
    });

    return start();
  }

  async archive(tripId: string, id: string) {
    const result = await asyncDb
      .prepare(
        `
        UPDATE booking_intents
        SET status = 'archived', updated_at = CURRENT_TIMESTAMP
        WHERE trip_id = ? AND id = ?
      `,
      )
      .run(tripId, id);

    if (result.changes === 0) return null;
    return this.getById(tripId, id);
  }

  private async getById(tripId: string, id: string | number) {
    const row = await this.getRow(tripId, id);
    return row ? toBookingIntent(row) : null;
  }

  private getRow(tripId: string, id: string | number) {
    return asyncDb
      .prepare('SELECT * FROM booking_intents WHERE trip_id = ? AND id = ?')
      .get<BookingIntentRow>(tripId, id);
  }
}
