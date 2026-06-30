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

const STATUSES = [
  'draft',
  'watching',
  'options_ready',
  'voting',
  'approved',
  'pending_checkout',
  'booked',
  'archived',
] as const;
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

export interface BookingIntentBookedInput {
  reservation_id?: unknown;
  reservationId?: unknown;
  reservation_url?: unknown;
  reservationUrl?: unknown;
  reservation_link?: unknown;
  reservationLink?: unknown;
  confirmation_number?: unknown;
  confirmationNumber?: unknown;
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
  checkout_option_id: number | null;
  checkout_provider: string | null;
  checkout_url: string | null;
  checkout_started_at: string | null;
  booked_at: string | null;
  reservation_id: number | null;
  reservation_url: string | null;
  confirmation_number: string | null;
  created_at: string;
  updated_at: string;
}

interface BookingIntentCheckoutOptionRow {
  id: number;
  booking_intent_id: number;
  provider: string;
  external_id: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  score: number | null;
  expires_at: string | null;
  checkout_url: string | null;
  metadata: string;
  status: string;
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

interface NormalizedBookedInput {
  reservationId: { provided: boolean; value: number | null };
  reservationUrl: { provided: boolean; value: string | null };
  confirmationNumber: { provided: boolean; value: string | null };
}

function hasOwn(data: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function firstPresent(
  data: object,
  keys: string[],
): { provided: true; value: unknown } | { provided: false; value?: undefined } {
  for (const key of keys) {
    if (hasOwn(data, key)) return { provided: true, value: (data as Record<string, unknown>)[key] };
  }
  return { provided: false };
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

function asOptionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BookingIntentValidationError(`${field} must be a positive integer`);
  }
  return parsed;
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

function hasExpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= nowMs;
}

function normalizeBookedInput(data: BookingIntentBookedInput | undefined): NormalizedBookedInput {
  const body = data ?? {};
  const reservationId = firstPresent(body, ['reservation_id', 'reservationId']);
  const reservationUrl = firstPresent(body, [
    'reservation_url',
    'reservationUrl',
    'reservation_link',
    'reservationLink',
  ]);
  const confirmationNumber = firstPresent(body, ['confirmation_number', 'confirmationNumber']);

  return {
    reservationId: {
      provided: reservationId.provided,
      value: reservationId.provided ? asOptionalPositiveInteger(reservationId.value, 'reservation_id') : null,
    },
    reservationUrl: {
      provided: reservationUrl.provided,
      value: reservationUrl.provided ? asOptionalString(reservationUrl.value, 'reservation_url', 2048) : null,
    },
    confirmationNumber: {
      provided: confirmationNumber.provided,
      value: confirmationNumber.provided
        ? asOptionalString(confirmationNumber.value, 'confirmation_number', 256)
        : null,
    },
  };
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
    checkout_option_id: row.checkout_option_id,
    checkout_provider: row.checkout_provider,
    checkout_url: row.checkout_url,
    checkout_started_at: row.checkout_started_at,
    booked_at: row.booked_at,
    reservation_id: row.reservation_id,
    reservation_url: row.reservation_url,
    confirmation_number: row.confirmation_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toCheckoutAction(row: BookingIntentCheckoutOptionRow, openedAt: string) {
  return {
    provider: row.provider,
    option_id: row.id,
    external_id: row.external_id,
    title: row.title,
    checkout_url: row.checkout_url,
    opened_at: openedAt,
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

  async prepareCheckoutHandoff(tripId: string, id: string) {
    const handoff = asyncDb.transaction(async () => {
      const existing = await this.getRow(tripId, id);
      if (!existing) return null;
      if (existing.status !== 'approved' && existing.status !== 'pending_checkout') {
        throw new BookingIntentValidationError('booking intent must be approved before checkout handoff');
      }

      const option = await this.getCheckoutOptionForIntent(tripId, existing);
      if (!option) {
        throw new BookingIntentValidationError('approved booking option not found');
      }
      if (option.status === 'archived') {
        throw new BookingIntentValidationError('approved booking option is archived');
      }
      if (option.status === 'expired' || hasExpired(option.expires_at, Date.now())) {
        throw new BookingIntentValidationError('approved booking option is expired');
      }
      if (!option.checkout_url) {
        throw new BookingIntentValidationError('approved booking option does not have a checkout link');
      }

      const openedAt = new Date().toISOString();
      await asyncDb
        .prepare(
          `
          UPDATE booking_intents
          SET status = 'pending_checkout',
              checkout_option_id = ?,
              checkout_provider = ?,
              checkout_url = ?,
              checkout_started_at = ?,
              updated_at = ?
          WHERE trip_id = ? AND id = ? AND status IN ('approved', 'pending_checkout')
        `,
        )
        .run(option.id, option.provider, option.checkout_url, openedAt, openedAt, tripId, id);

      const bookingIntent = await this.getById(tripId, id);
      return bookingIntent
        ? {
            bookingIntent,
            handoff: toCheckoutAction(option, openedAt),
          }
        : null;
    });

    return handoff();
  }

  async markBooked(tripId: string, id: string, data?: BookingIntentBookedInput) {
    const mark = asyncDb.transaction(async () => {
      const existing = await this.getRow(tripId, id);
      if (!existing) return null;
      if (existing.status === 'archived') {
        throw new BookingIntentValidationError('archived booking intents cannot be marked booked');
      }
      if (!['approved', 'pending_checkout', 'booked'].includes(existing.status)) {
        throw new BookingIntentValidationError(
          'booking intent must be approved or pending checkout before marking booked',
        );
      }

      const normalized = normalizeBookedInput(data);
      if (normalized.reservationId.provided && normalized.reservationId.value !== null) {
        await this.assertReservationBelongsToTrip(tripId, normalized.reservationId.value);
      }

      const option = await this.getCheckoutOptionForIntent(tripId, existing);
      if (!option && existing.status !== 'booked') {
        throw new BookingIntentValidationError('approved booking option not found');
      }

      const now = new Date().toISOString();
      const checkoutOptionId = option?.id ?? existing.checkout_option_id;
      const checkoutProvider = option?.provider ?? existing.checkout_provider;
      const checkoutUrl = option?.checkout_url ?? existing.checkout_url;
      const checkoutStartedAt = existing.checkout_started_at ?? now;
      const reservationId = normalized.reservationId.provided
        ? normalized.reservationId.value
        : existing.reservation_id;
      const reservationUrl = normalized.reservationUrl.provided
        ? normalized.reservationUrl.value
        : existing.reservation_url;
      const confirmationNumber = normalized.confirmationNumber.provided
        ? normalized.confirmationNumber.value
        : existing.confirmation_number;

      await asyncDb
        .prepare(
          `
          UPDATE booking_intents
          SET status = 'booked',
              checkout_option_id = ?,
              checkout_provider = ?,
              checkout_url = ?,
              checkout_started_at = ?,
              booked_at = ?,
              reservation_id = ?,
              reservation_url = ?,
              confirmation_number = ?,
              updated_at = ?
          WHERE trip_id = ? AND id = ?
        `,
        )
        .run(
          checkoutOptionId,
          checkoutProvider,
          checkoutUrl,
          checkoutStartedAt,
          now,
          reservationId,
          reservationUrl,
          confirmationNumber,
          now,
          tripId,
          id,
        );

      return this.getById(tripId, id);
    });

    return mark();
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

  private async getCheckoutOptionForIntent(
    tripId: string,
    intent: BookingIntentRow,
  ): Promise<BookingIntentCheckoutOptionRow | undefined> {
    if (intent.checkout_option_id) {
      const stored = await this.getCheckoutOptionById(tripId, intent.id, intent.checkout_option_id);
      if (stored) return stored;
    }
    return this.findApprovedCheckoutOption(tripId, intent.id);
  }

  private getCheckoutOptionById(tripId: string, intentId: string | number, optionId: string | number) {
    return asyncDb
      .prepare(
        `
        SELECT bo.*
        FROM booking_options bo
        JOIN booking_intents bi ON bi.id = bo.booking_intent_id
        WHERE bi.trip_id = ? AND bi.id = ? AND bo.id = ?
      `,
      )
      .get<BookingIntentCheckoutOptionRow>(tripId, intentId, optionId);
  }

  private findApprovedCheckoutOption(tripId: string, intentId: string | number) {
    return asyncDb
      .prepare(
        `
        SELECT bo.*
        FROM group_decisions d
        JOIN group_decision_links l
          ON l.decision_id = d.id
         AND l.target_type = 'booking_intent'
         AND l.target_id = ?
        JOIN group_decision_options gdo
          ON gdo.decision_id = d.id
         AND gdo.id = d.final_option_id
        JOIN booking_options bo
          ON bo.id = gdo.booking_option_id
         AND bo.booking_intent_id = ?
        WHERE d.trip_id = ? AND d.state = 'decided'
        ORDER BY d.updated_at DESC, d.id DESC
        LIMIT 1
      `,
      )
      .get<BookingIntentCheckoutOptionRow>(intentId, intentId, tripId);
  }

  private async assertReservationBelongsToTrip(tripId: string, reservationId: number): Promise<void> {
    const row = await asyncDb
      .prepare('SELECT id FROM reservations WHERE id = ? AND trip_id = ?')
      .get<{ id: number }>(reservationId, tripId);
    if (!row) {
      throw new BookingIntentValidationError('reservation_id must belong to this trip');
    }
  }

  private getRow(tripId: string, id: string | number) {
    return asyncDb
      .prepare('SELECT * FROM booking_intents WHERE trip_id = ? AND id = ?')
      .get<BookingIntentRow>(tripId, id);
  }
}
