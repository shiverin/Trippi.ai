import { asyncDb, canAccessTripAsync } from '../../db/asyncDatabase';
import { checkPermissionAsync } from '../../services/permissions';
import type { User } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

const STATUSES = ['current', 'expired', 'archived'] as const;
const STATUS_SET = new Set<string>(STATUSES);
const LIST_STATUSES = ['all', ...STATUSES] as const;
const LIST_STATUS_SET = new Set<string>(LIST_STATUSES);

export type BookingOptionStatus = (typeof STATUSES)[number];
export type BookingOptionListStatus = (typeof LIST_STATUSES)[number];

export interface BookingOptionInput {
  provider?: unknown;
  external_id?: unknown;
  externalId?: unknown;
  title?: unknown;
  price?: unknown;
  currency?: unknown;
  score?: unknown;
  expires_at?: unknown;
  expiresAt?: unknown;
  checkout_url?: unknown;
  checkoutUrl?: unknown;
  deep_link_url?: unknown;
  deepLink?: unknown;
  metadata?: unknown;
  status?: unknown;
}

interface BookingOptionRow {
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
  status: BookingOptionStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface BookingIntentRef {
  id: number;
  trip_id: number;
}

interface NormalizedCreateInput {
  provider: string;
  external_id: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  score: number | null;
  expires_at: string | null;
  checkout_url: string | null;
  metadata: string;
  status: BookingOptionStatus;
}

interface NormalizedUpdateInput {
  sets: string[];
  values: unknown[];
}

export class BookingOptionValidationError extends Error {}

function hasOwn(data: BookingOptionInput, key: keyof BookingOptionInput): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function firstPresent(
  data: BookingOptionInput,
  keys: Array<keyof BookingOptionInput>,
): { provided: true; value: unknown } | { provided: false; value?: undefined } {
  for (const key of keys) {
    if (hasOwn(data, key)) return { provided: true, value: data[key] };
  }
  return { provided: false };
}

function asOptionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BookingOptionValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BookingOptionValidationError(`${field} must be ${max} characters or less`);
  return trimmed || null;
}

function asRequiredString(value: unknown, field: string, max: number): string {
  const trimmed = asOptionalString(value, field, max);
  if (!trimmed) throw new BookingOptionValidationError(`${field} is required`);
  return trimmed;
}

function asOptionalNumber(value: unknown, field: string, min?: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BookingOptionValidationError(`${field} must be a finite number`);
  }
  if (min !== undefined && value < min) {
    throw new BookingOptionValidationError(`${field} must be greater than or equal to ${min}`);
  }
  return value;
}

function asStatus(value: unknown, fallback: BookingOptionStatus): BookingOptionStatus {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !STATUS_SET.has(value)) {
    throw new BookingOptionValidationError(`status must be one of: ${STATUSES.join(', ')}`);
  }
  return value as BookingOptionStatus;
}

function asListStatus(value: unknown): BookingOptionListStatus | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !LIST_STATUS_SET.has(value)) {
    throw new BookingOptionValidationError(`status must be one of: ${LIST_STATUSES.join(', ')}`);
  }
  return value as BookingOptionListStatus;
}

function asOptionalDateTime(value: unknown, field: string): string | null {
  const raw = asOptionalString(value, field, 128);
  if (!raw) return null;
  if (!Number.isFinite(Date.parse(raw))) {
    throw new BookingOptionValidationError(`${field} must be a valid date/time`);
  }
  return raw;
}

function asJsonObject(value: unknown, field: string): string {
  const normalized = value === undefined || value === null ? {} : value;
  if (typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new BookingOptionValidationError(`${field} must be an object`);
  }
  const json = JSON.stringify(normalized);
  if (json.length > 50000) {
    throw new BookingOptionValidationError(`${field} must be 50000 characters or less`);
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

function toBookingOption(row: BookingOptionRow, nowMs = Date.now()) {
  const isExpired = row.status === 'expired' || (row.status === 'current' && hasExpired(row.expires_at, nowMs));
  const status: BookingOptionStatus = isExpired && row.status !== 'archived' ? 'expired' : row.status;
  return {
    id: row.id,
    booking_intent_id: row.booking_intent_id,
    provider: row.provider,
    external_id: row.external_id,
    title: row.title,
    price: row.price,
    currency: row.currency,
    score: row.score,
    expires_at: row.expires_at,
    checkout_url: row.checkout_url,
    metadata: parseJsonObject(row.metadata),
    status,
    is_expired: status === 'expired',
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

function normalizeCreateInput(data: BookingOptionInput): NormalizedCreateInput {
  const external = firstPresent(data, ['external_id', 'externalId']);
  const expires = firstPresent(data, ['expires_at', 'expiresAt']);
  const checkout = firstPresent(data, ['checkout_url', 'checkoutUrl', 'deep_link_url', 'deepLink']);

  return {
    provider: asRequiredString(data.provider, 'provider', 128),
    external_id: asOptionalString(external.value, 'external_id', 500),
    title: asOptionalString(data.title, 'title', 500),
    price: asOptionalNumber(data.price, 'price', 0),
    currency: asOptionalString(data.currency, 'currency', 12),
    score: asOptionalNumber(data.score, 'score'),
    expires_at: asOptionalDateTime(expires.value, 'expires_at'),
    checkout_url: asOptionalString(checkout.value, 'checkout_url', 2048),
    metadata: asJsonObject(data.metadata, 'metadata'),
    status: asStatus(data.status, 'current'),
  };
}

function normalizeUpdateInput(data: BookingOptionInput): NormalizedUpdateInput {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (hasOwn(data, 'provider')) add('provider', asRequiredString(data.provider, 'provider', 128));

  const external = firstPresent(data, ['external_id', 'externalId']);
  if (external.provided) add('external_id', asOptionalString(external.value, 'external_id', 500));

  if (hasOwn(data, 'title')) add('title', asOptionalString(data.title, 'title', 500));
  if (hasOwn(data, 'price')) add('price', asOptionalNumber(data.price, 'price', 0));
  if (hasOwn(data, 'currency')) add('currency', asOptionalString(data.currency, 'currency', 12));
  if (hasOwn(data, 'score')) add('score', asOptionalNumber(data.score, 'score'));

  const expires = firstPresent(data, ['expires_at', 'expiresAt']);
  if (expires.provided) add('expires_at', asOptionalDateTime(expires.value, 'expires_at'));

  const checkout = firstPresent(data, ['checkout_url', 'checkoutUrl', 'deep_link_url', 'deepLink']);
  if (checkout.provided) add('checkout_url', asOptionalString(checkout.value, 'checkout_url', 2048));

  if (hasOwn(data, 'metadata')) add('metadata', asJsonObject(data.metadata, 'metadata'));
  if (hasOwn(data, 'status')) add('status', asStatus(data.status, 'current'));

  return { sets, values };
}

type TripAccess = NonNullable<Awaited<ReturnType<typeof canAccessTripAsync>>>;

@Injectable()
export class BookingOptionsService {
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

  async list(tripId: string, intentId: string, status?: unknown) {
    const parsedStatus = asListStatus(status);
    if (!(await this.getIntent(tripId, intentId))) return null;

    const rows = await asyncDb
      .prepare(
        `
        SELECT bo.*
        FROM booking_options bo
        JOIN booking_intents bi ON bi.id = bo.booking_intent_id
        WHERE bi.trip_id = ? AND bo.booking_intent_id = ?
        ORDER BY
          CASE WHEN bo.score IS NULL THEN 1 ELSE 0 END ASC,
          bo.score DESC,
          CASE WHEN bo.price IS NULL THEN 1 ELSE 0 END ASC,
          bo.price ASC,
          bo.updated_at DESC,
          bo.id DESC
      `,
      )
      .all<BookingOptionRow>(tripId, intentId);

    return rows
      .map((row) => toBookingOption(row))
      .filter((option) => {
        if (!parsedStatus) return option.status !== 'archived';
        if (parsedStatus === 'all') return true;
        return option.status === parsedStatus;
      });
  }

  async upsertFromWorker(tripId: string, intentId: string, data: BookingOptionInput) {
    if (!(await this.getIntent(tripId, intentId))) return null;
    const normalized = normalizeCreateInput(data);

    if (normalized.external_id) {
      const existing = await this.getRowByExternalId(tripId, intentId, normalized.provider, normalized.external_id);
      if (existing) {
        const update = normalizeUpdateInput(data);
        if (!hasOwn(data, 'status')) {
          update.sets.push('status = ?');
          update.values.push(existing.status === 'archived' ? 'archived' : 'current');
        }
        return this.applyUpdate(tripId, intentId, existing.id, update);
      }
    }

    const result = await asyncDb
      .prepare(
        `
        INSERT INTO booking_options
          (booking_intent_id, provider, external_id, title, price, currency, score, expires_at, checkout_url, metadata, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        intentId,
        normalized.provider,
        normalized.external_id,
        normalized.title,
        normalized.price,
        normalized.currency,
        normalized.score,
        normalized.expires_at,
        normalized.checkout_url,
        normalized.metadata,
        normalized.status,
      );

    return this.getById(tripId, intentId, Number(result.lastInsertRowid));
  }

  async update(tripId: string, intentId: string, optionId: string, data: BookingOptionInput) {
    const existing = await this.getRow(tripId, intentId, optionId);
    if (!existing) return null;
    return this.applyUpdate(tripId, intentId, optionId, normalizeUpdateInput(data));
  }

  async archive(tripId: string, intentId: string, optionId: string) {
    const existing = await this.getRow(tripId, intentId, optionId);
    if (!existing) return null;

    await asyncDb
      .prepare(
        `
        UPDATE booking_options
        SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      )
      .run(optionId);

    return this.getById(tripId, intentId, optionId);
  }

  async expire(tripId: string, intentId: string, optionId: string) {
    const existing = await this.getRow(tripId, intentId, optionId);
    if (!existing) return null;

    await asyncDb
      .prepare(
        `
        UPDATE booking_options
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      )
      .run(optionId);

    return this.getById(tripId, intentId, optionId);
  }

  private async applyUpdate(
    tripId: string,
    intentId: string,
    optionId: string | number,
    update: NormalizedUpdateInput,
  ) {
    if (update.sets.length === 0) return this.getById(tripId, intentId, optionId);

    update.values.push(optionId);
    await asyncDb
      .prepare(
        `
        UPDATE booking_options
        SET ${update.sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      )
      .run(...update.values);

    return this.getById(tripId, intentId, optionId);
  }

  private async getIntent(tripId: string, intentId: string | number) {
    return asyncDb
      .prepare('SELECT id, trip_id FROM booking_intents WHERE trip_id = ? AND id = ?')
      .get<BookingIntentRef>(tripId, intentId);
  }

  private async getById(tripId: string, intentId: string | number, optionId: string | number) {
    const row = await this.getRow(tripId, intentId, optionId);
    return row ? toBookingOption(row) : null;
  }

  private getRow(tripId: string, intentId: string | number, optionId: string | number) {
    return asyncDb
      .prepare(
        `
        SELECT bo.*
        FROM booking_options bo
        JOIN booking_intents bi ON bi.id = bo.booking_intent_id
        WHERE bi.trip_id = ? AND bo.booking_intent_id = ? AND bo.id = ?
      `,
      )
      .get<BookingOptionRow>(tripId, intentId, optionId);
  }

  private getRowByExternalId(tripId: string, intentId: string | number, provider: string, externalId: string) {
    return asyncDb
      .prepare(
        `
        SELECT bo.*
        FROM booking_options bo
        JOIN booking_intents bi ON bi.id = bo.booking_intent_id
        WHERE bi.trip_id = ? AND bo.booking_intent_id = ? AND bo.provider = ? AND bo.external_id = ?
      `,
      )
      .get<BookingOptionRow>(tripId, intentId, provider, externalId);
  }
}
