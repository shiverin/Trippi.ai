import { asyncDb, canAccessTripAsync } from '../../db/asyncDatabase';
import { checkPermissionAsync } from '../../services/permissions';
import type { User } from '../../types';
import { Injectable } from '@nestjs/common';

const DECISION_STATES = ['open', 'closed', 'decided', 'cancelled'] as const;
const RESPONSE_STATES = ['selected', 'maybe', 'declined', 'abstain'] as const;
const LINK_TARGET_TYPES = ['trip', 'day', 'place', 'reservation', 'booking_intent', 'packing_item'] as const;

type DecisionState = (typeof DECISION_STATES)[number];
type ResponseState = (typeof RESPONSE_STATES)[number];
type LinkTargetType = (typeof LINK_TARGET_TYPES)[number];

type Trip = { id: number; user_id: number };

interface DecisionRow {
  id: number;
  trip_id: number;
  created_by: number;
  title: string;
  description: string | null;
  deadline: string | null;
  state: DecisionState;
  final_option_id: number | null;
  created_at: string;
  updated_at: string;
  created_by_username?: string;
  created_by_avatar?: string | null;
}

interface BookingIntentDecisionRow {
  id: number;
  trip_id: number;
  type: string;
  origin: string | null;
  destination: string | null;
  status: string;
}

interface OptionRow {
  id: number;
  decision_id: number;
  booking_option_id: number | null;
  label: string;
  description: string | null;
  sort_order: number;
  metadata: string | null;
  created_at: string;
}

interface BookingOptionDecisionRow {
  id: number;
  booking_intent_id: number;
  provider: string;
  external_id: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  score: number | null;
  expires_at: string | null;
  metadata: string;
  status: string;
}

interface ResponseRow {
  id: number;
  decision_id: number;
  option_id: number | null;
  user_id: number;
  response: ResponseState;
  comment: string | null;
  created_at: string;
  updated_at: string;
  username: string;
  avatar: string | null;
}

interface LinkRow {
  id: number;
  decision_id: number;
  target_type: LinkTargetType;
  target_id: number;
  created_at: string;
}

interface NormalizedOption {
  label: string;
  description: string | null;
  sortOrder: number;
  metadata: string | null;
  bookingOptionId: number | null;
}

interface NormalizedLink {
  targetType: LinkTargetType;
  targetId: number;
}

export class GroupDecisionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupDecisionInputError';
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new GroupDecisionInputError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new GroupDecisionInputError(`${field} is required`);
  }
  return trimmed;
}

function normalizeOptionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new GroupDecisionInputError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePositiveId(value: unknown, field: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) {
    throw new GroupDecisionInputError(`${field} must be a positive integer`);
  }
  return n;
}

function normalizeOptionalPositiveId(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return normalizePositiveId(value, field);
}

function normalizePositiveIdArray(value: unknown, field: string): number[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new GroupDecisionInputError(`${field} must be an array`);
  }

  const seen = new Set<number>();
  const ids: number[] = [];
  value.forEach((item, index) => {
    const id = normalizePositiveId(item, `${field}[${index}]`);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
}

function normalizeNonNegativeInteger(value: unknown, field: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new GroupDecisionInputError(`${field} must be a non-negative integer`);
  }
  return n;
}

function normalizeState(value: unknown, field: string): DecisionState {
  if (typeof value !== 'string' || !DECISION_STATES.includes(value as DecisionState)) {
    throw new GroupDecisionInputError(`${field} must be one of: ${DECISION_STATES.join(', ')}`);
  }
  return value as DecisionState;
}

function normalizeResponse(value: unknown): ResponseState {
  if (value === undefined || value === null) return 'selected';
  if (typeof value !== 'string' || !RESPONSE_STATES.includes(value as ResponseState)) {
    throw new GroupDecisionInputError(`response must be one of: ${RESPONSE_STATES.join(', ')}`);
  }
  return value as ResponseState;
}

function normalizeMetadata(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    throw new GroupDecisionInputError('option metadata must be JSON-serializable');
  }
}

function parseMetadata(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeOptions(raw: unknown): NormalizedOption[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new GroupDecisionInputError('At least 2 options are required');
  }

  return raw.map((item, index) => {
    if (typeof item === 'string') {
      return {
        label: normalizeRequiredString(item, `options[${index}]`),
        description: null,
        sortOrder: index,
        metadata: null,
        bookingOptionId: null,
      };
    }

    if (!item || typeof item !== 'object') {
      throw new GroupDecisionInputError(`options[${index}] must be a string or object`);
    }

    const record = item as Record<string, unknown>;
    const labelValue = record.label ?? record.title;
    const sortOrder =
      record.sort_order === undefined || record.sort_order === null
        ? index
        : normalizeNonNegativeInteger(record.sort_order, `options[${index}].sort_order`);

    return {
      label: normalizeRequiredString(labelValue, `options[${index}].label`),
      description: normalizeOptionalString(record.description, `options[${index}].description`),
      sortOrder,
      metadata: normalizeMetadata(record.metadata),
      bookingOptionId: normalizeOptionalPositiveId(
        record.booking_option_id ?? record.bookingOptionId,
        `options[${index}].booking_option_id`,
      ),
    };
  });
}

function normalizeLinks(raw: unknown): NormalizedLink[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new GroupDecisionInputError('links must be an array');
  }

  const seen = new Set<string>();
  const links: NormalizedLink[] = [];

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new GroupDecisionInputError(`links[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const rawType = record.target_type ?? record.type;
    if (typeof rawType !== 'string' || !LINK_TARGET_TYPES.includes(rawType as LinkTargetType)) {
      throw new GroupDecisionInputError(`links[${index}].target_type is invalid`);
    }

    const targetId = normalizePositiveId(record.target_id ?? record.id, `links[${index}].target_id`);
    const targetType = rawType as LinkTargetType;
    const key = `${targetType}:${targetId}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ targetType, targetId });
    }
  });

  return links;
}

function hasExpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= nowMs;
}

function formatPrice(price: number | null, currency: string | null): string | null {
  if (price == null) return null;
  const amount = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return currency ? `${currency.toUpperCase()} ${amount}` : amount;
}

function bookingIntentTitle(intent: BookingIntentDecisionRow): string {
  const type = intent.type.replace(/[_-]+/g, ' ');
  const route = [intent.origin, intent.destination].filter(Boolean).join(' to ');
  return route ? `Approve ${type} for ${route}` : `Approve ${type} option`;
}

function bookingIntentDescription(intent: BookingIntentDecisionRow): string {
  const type = intent.type.replace(/[_-]+/g, ' ');
  return `Choose which ${type} option the group approves before checkout.`;
}

function bookingOptionLabel(option: BookingOptionDecisionRow): string {
  const base = option.title?.trim() || option.provider;
  const price = formatPrice(option.price, option.currency);
  return price ? `${base} - ${price}` : base;
}

function bookingOptionDescription(option: BookingOptionDecisionRow): string | null {
  const details = [option.provider, option.score == null ? null : `Score ${option.score}`].filter(Boolean);
  return details.length > 0 ? details.join(' - ') : null;
}

function bookingOptionMetadata(option: BookingOptionDecisionRow): string {
  return JSON.stringify({
    provider: option.provider,
    external_id: option.external_id,
    price: option.price,
    currency: option.currency,
    score: option.score,
    expires_at: option.expires_at,
  });
}

@Injectable()
export class DecisionsService {
  verifyTripAccess(tripId: string, userId: number): Promise<Trip | undefined> {
    return canAccessTripAsync(Number(tripId), userId);
  }

  canEdit(trip: Trip, user: User): Promise<boolean> {
    return checkPermissionAsync('trip_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  async list(tripId: string) {
    const rows = await asyncDb
      .prepare(
        `
        SELECT d.*, u.username AS created_by_username, u.avatar AS created_by_avatar
        FROM group_decisions d
        JOIN users u ON u.id = d.created_by
        WHERE d.trip_id = ?
        ORDER BY d.created_at DESC, d.id DESC
      `,
      )
      .all<DecisionRow>(tripId);

    return Promise.all(rows.map((row) => this.formatDecision(row)));
  }

  async get(tripId: string, decisionId: string | number) {
    const row = await this.getDecisionRow(tripId, decisionId);
    return row ? this.formatDecision(row) : null;
  }

  async create(tripId: string, userId: number, input: Record<string, unknown>) {
    const title = normalizeRequiredString(input.title, 'title');
    const description = normalizeOptionalString(input.description, 'description');
    const deadline = normalizeOptionalString(input.deadline, 'deadline');
    const state = input.state === undefined || input.state === null ? 'open' : normalizeState(input.state, 'state');
    const options = normalizeOptions(input.options);
    const links = normalizeLinks(input.links);
    await this.assertLinksBelongToTrip(tripId, links);
    await this.assertBookingOptionsBelongToTrip(
      tripId,
      options.map((option) => option.bookingOptionId).filter((id): id is number => id !== null),
    );

    const decisionId = await asyncDb.transaction(async () =>
      this.insertDecision({
        tripId,
        userId,
        title,
        description,
        deadline,
        state,
        options,
        links,
      }),
    )();
    return this.get(tripId, decisionId);
  }

  async createFromBookingIntent(
    tripId: string,
    intentId: string | number,
    userId: number,
    input: Record<string, unknown>,
  ) {
    const intent = await this.getBookingIntentRow(tripId, intentId);
    if (!intent) return null;
    if (intent.status === 'archived' || intent.status === 'pending_checkout' || intent.status === 'booked') {
      throw new GroupDecisionInputError(`${intent.status} booking intents cannot create decisions`);
    }

    const selectedOptionIds = normalizePositiveIdArray(input.option_ids ?? input.optionIds, 'option_ids');
    if (selectedOptionIds && selectedOptionIds.length < 2) {
      throw new GroupDecisionInputError('At least 2 booking options are required');
    }

    const rows = await this.listCurrentBookingOptionsForIntent(tripId, intentId, selectedOptionIds);
    const optionsById = new Map(rows.map((option) => [option.id, option]));
    const orderedRows = selectedOptionIds ? selectedOptionIds.map((id) => optionsById.get(id)).filter(Boolean) : rows;
    const bookingOptions = orderedRows as BookingOptionDecisionRow[];
    if (selectedOptionIds && bookingOptions.length !== selectedOptionIds.length) {
      throw new GroupDecisionInputError('Selected booking options must belong to this intent and be current');
    }
    if (bookingOptions.length < 2) {
      throw new GroupDecisionInputError('At least 2 current booking options are required');
    }

    const title = normalizeOptionalString(input.title, 'title') ?? bookingIntentTitle(intent);
    const description = normalizeOptionalString(input.description, 'description') ?? bookingIntentDescription(intent);
    const deadline = normalizeOptionalString(input.deadline, 'deadline');
    const options = bookingOptions.map((option, index) => ({
      label: bookingOptionLabel(option),
      description: bookingOptionDescription(option),
      sortOrder: index,
      metadata: bookingOptionMetadata(option),
      bookingOptionId: option.id,
    }));
    const links = [{ targetType: 'booking_intent' as const, targetId: Number(intent.id) }];

    const decisionId = await asyncDb.transaction(async () => {
      const newDecisionId = await this.insertDecision({
        tripId,
        userId,
        title,
        description,
        deadline,
        state: 'open',
        options,
        links,
      });
      await asyncDb
        .prepare(
          `
          UPDATE booking_intents
          SET status = 'voting', updated_at = CURRENT_TIMESTAMP
          WHERE trip_id = ? AND id = ?
        `,
        )
        .run(tripId, intentId);
      return newDecisionId;
    })();

    return this.get(tripId, decisionId);
  }

  async update(tripId: string, decisionId: string | number, input: Record<string, unknown>) {
    const existing = await this.getDecisionRow(tripId, decisionId);
    if (!existing) return null;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (Object.prototype.hasOwnProperty.call(input, 'title')) {
      updates.push('title = ?');
      params.push(normalizeRequiredString(input.title, 'title'));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
      updates.push('description = ?');
      params.push(normalizeOptionalString(input.description, 'description'));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'deadline')) {
      updates.push('deadline = ?');
      params.push(normalizeOptionalString(input.deadline, 'deadline'));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'state')) {
      const state = normalizeState(input.state, 'state');
      if (state === 'decided' && !existing.final_option_id && input.final_option_id === undefined) {
        throw new GroupDecisionInputError('final_option_id is required when state is decided');
      }
      updates.push('state = ?');
      params.push(state);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'final_option_id')) {
      if (input.final_option_id === null) {
        updates.push('final_option_id = ?');
        params.push(null);
      } else {
        const optionId = normalizePositiveId(input.final_option_id, 'final_option_id');
        await this.assertOptionBelongsToDecision(decisionId, optionId);
        updates.push('final_option_id = ?');
        params.push(optionId);
      }
    }

    const replaceLinks = Object.prototype.hasOwnProperty.call(input, 'links');
    const links = replaceLinks ? normalizeLinks(input.links) : [];
    if (replaceLinks) {
      await this.assertLinksBelongToTrip(tripId, links);
    }

    await asyncDb.transaction(async () => {
      if (updates.length > 0) {
        params.push(decisionId);
        await asyncDb
          .prepare(
            `
            UPDATE group_decisions
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          )
          .run(...params);
      }
      if (replaceLinks) {
        await this.replaceLinks(Number(decisionId), links);
      }
      const updated = await this.getDecisionRow(tripId, decisionId);
      if (updated?.state === 'decided' && updated.final_option_id) {
        await this.approveLinkedBookingIntent(tripId, decisionId, updated.final_option_id);
      }
    })();

    return this.get(tripId, decisionId);
  }

  async respond(tripId: string, decisionId: string | number, userId: number, input: Record<string, unknown>) {
    const existing = await this.getDecisionRow(tripId, decisionId);
    if (!existing) return null;
    if (existing.state !== 'open') {
      throw new GroupDecisionInputError('Decision is not open for responses');
    }

    const response = normalizeResponse(input.response);
    const optionId =
      input.option_id === undefined || input.option_id === null
        ? null
        : normalizePositiveId(input.option_id, 'option_id');
    if (response === 'selected' && optionId === null) {
      throw new GroupDecisionInputError('option_id is required for selected responses');
    }
    if (optionId !== null) {
      await this.assertOptionBelongsToDecision(decisionId, optionId);
    }
    const comment = normalizeOptionalString(input.comment, 'comment');

    await asyncDb
      .prepare(
        `
        INSERT INTO group_decision_responses (decision_id, option_id, user_id, response, comment)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(decision_id, user_id) DO UPDATE SET
          option_id = excluded.option_id,
          response = excluded.response,
          comment = excluded.comment,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(decisionId, optionId, userId, response, comment);

    return this.get(tripId, decisionId);
  }

  async finalize(tripId: string, decisionId: string | number, optionIdValue: unknown) {
    const existing = await this.getDecisionRow(tripId, decisionId);
    if (!existing) return null;
    const optionId = normalizePositiveId(optionIdValue, 'option_id');
    await this.assertOptionBelongsToDecision(decisionId, optionId);

    await asyncDb.transaction(async () => {
      await asyncDb
        .prepare(
          `
          UPDATE group_decisions
          SET final_option_id = ?, state = 'decided', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND trip_id = ?
        `,
        )
        .run(optionId, decisionId, tripId);
      await this.approveLinkedBookingIntent(tripId, decisionId, optionId);
    })();

    return this.get(tripId, decisionId);
  }

  private async insertDecision({
    tripId,
    userId,
    title,
    description,
    deadline,
    state,
    options,
    links,
  }: {
    tripId: string;
    userId: number;
    title: string;
    description: string | null;
    deadline: string | null;
    state: DecisionState;
    options: NormalizedOption[];
    links: NormalizedLink[];
  }): Promise<number> {
    const result = await asyncDb
      .prepare(
        `
        INSERT INTO group_decisions (trip_id, created_by, title, description, deadline, state)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(tripId, userId, title, description, deadline, state);
    const decisionId = Number(result.lastInsertRowid);

    const insertOption = asyncDb.prepare(
      `
      INSERT INTO group_decision_options
        (decision_id, booking_option_id, label, description, sort_order, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    );
    for (const option of options) {
      await insertOption.run(
        decisionId,
        option.bookingOptionId,
        option.label,
        option.description,
        option.sortOrder,
        option.metadata,
      );
    }

    await this.replaceLinks(decisionId, links);
    return decisionId;
  }

  private async getDecisionRow(tripId: string, decisionId: string | number): Promise<DecisionRow | undefined> {
    return asyncDb
      .prepare(
        `
        SELECT d.*, u.username AS created_by_username, u.avatar AS created_by_avatar
        FROM group_decisions d
        JOIN users u ON u.id = d.created_by
        WHERE d.trip_id = ? AND d.id = ?
      `,
      )
      .get<DecisionRow>(tripId, decisionId);
  }

  private async getBookingIntentRow(
    tripId: string,
    intentId: string | number,
  ): Promise<BookingIntentDecisionRow | undefined> {
    return asyncDb
      .prepare(
        `
        SELECT id, trip_id, type, origin, destination, status
        FROM booking_intents
        WHERE trip_id = ? AND id = ?
      `,
      )
      .get<BookingIntentDecisionRow>(tripId, intentId);
  }

  private async listCurrentBookingOptionsForIntent(
    tripId: string,
    intentId: string | number,
    optionIds: number[] | null,
  ): Promise<BookingOptionDecisionRow[]> {
    const rows = await asyncDb
      .prepare(
        `
        SELECT bo.*
        FROM booking_options bo
        JOIN booking_intents bi ON bi.id = bo.booking_intent_id
        WHERE bi.trip_id = ? AND bi.id = ? AND bo.status = 'current'
        ORDER BY
          CASE WHEN bo.score IS NULL THEN 1 ELSE 0 END ASC,
          bo.score DESC,
          CASE WHEN bo.price IS NULL THEN 1 ELSE 0 END ASC,
          bo.price ASC,
          bo.updated_at DESC,
          bo.id DESC
      `,
      )
      .all<BookingOptionDecisionRow>(tripId, intentId);
    const requested = optionIds ? new Set(optionIds) : null;
    const nowMs = Date.now();
    return rows.filter((row) => !hasExpired(row.expires_at, nowMs) && (!requested || requested.has(row.id)));
  }

  private async formatDecision(row: DecisionRow) {
    const options = await asyncDb
      .prepare(
        `
        SELECT * FROM group_decision_options
        WHERE decision_id = ?
        ORDER BY sort_order ASC, id ASC
      `,
      )
      .all<OptionRow>(row.id);
    const responses = await asyncDb
      .prepare(
        `
        SELECT r.*, u.username, u.avatar
        FROM group_decision_responses r
        JOIN users u ON u.id = r.user_id
        WHERE r.decision_id = ?
        ORDER BY r.updated_at DESC, r.id DESC
      `,
      )
      .all<ResponseRow>(row.id);
    const links = await asyncDb
      .prepare(
        `
        SELECT * FROM group_decision_links
        WHERE decision_id = ?
        ORDER BY id ASC
      `,
      )
      .all<LinkRow>(row.id);

    const formattedOptions = options.map((option) => ({
      id: option.id,
      decision_id: option.decision_id,
      booking_option_id: option.booking_option_id,
      label: option.label,
      description: option.description,
      sort_order: option.sort_order,
      metadata: parseMetadata(option.metadata),
      created_at: option.created_at,
    }));

    return {
      id: row.id,
      trip_id: row.trip_id,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      created_by_avatar: row.created_by_avatar ?? null,
      title: row.title,
      description: row.description,
      deadline: row.deadline,
      state: row.state,
      final_option_id: row.final_option_id,
      final_option: formattedOptions.find((option) => option.id === row.final_option_id) ?? null,
      options: formattedOptions,
      responses: responses.map((response) => ({
        id: response.id,
        decision_id: response.decision_id,
        option_id: response.option_id,
        user_id: response.user_id,
        response: response.response,
        comment: response.comment,
        username: response.username,
        avatar: response.avatar,
        created_at: response.created_at,
        updated_at: response.updated_at,
      })),
      links: links.map((link) => ({
        id: link.id,
        decision_id: link.decision_id,
        target_type: link.target_type,
        target_id: link.target_id,
        created_at: link.created_at,
      })),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private async replaceLinks(decisionId: number, links: NormalizedLink[]): Promise<void> {
    await asyncDb.prepare('DELETE FROM group_decision_links WHERE decision_id = ?').run(decisionId);
    if (links.length === 0) return;

    const insert = asyncDb.prepare(
      `
      INSERT OR IGNORE INTO group_decision_links (decision_id, target_type, target_id)
      VALUES (?, ?, ?)
    `,
    );
    for (const link of links) {
      await insert.run(decisionId, link.targetType, link.targetId);
    }
  }

  private async assertOptionBelongsToDecision(decisionId: string | number, optionId: number): Promise<void> {
    const option = await asyncDb
      .prepare('SELECT id FROM group_decision_options WHERE id = ? AND decision_id = ?')
      .get<{ id: number }>(optionId, decisionId);
    if (!option) {
      throw new GroupDecisionInputError('Option not found for this decision');
    }
  }

  private async assertBookingOptionsBelongToTrip(tripId: string, optionIds: number[]): Promise<void> {
    const seen = new Set<number>();
    for (const optionId of optionIds) {
      if (seen.has(optionId)) continue;
      seen.add(optionId);
      const option = await asyncDb
        .prepare(
          `
          SELECT bo.id
          FROM booking_options bo
          JOIN booking_intents bi ON bi.id = bo.booking_intent_id
          WHERE bo.id = ? AND bi.trip_id = ?
        `,
        )
        .get<{ id: number }>(optionId, tripId);
      if (!option) {
        throw new GroupDecisionInputError('Booking option not found on this trip');
      }
    }
  }

  private async approveLinkedBookingIntent(
    tripId: string,
    decisionId: string | number,
    finalOptionId: number,
  ): Promise<void> {
    const option = await asyncDb
      .prepare('SELECT booking_option_id FROM group_decision_options WHERE id = ? AND decision_id = ?')
      .get<{ booking_option_id: number | null }>(finalOptionId, decisionId);
    if (!option?.booking_option_id) return;

    const linkedIntent = await asyncDb
      .prepare(
        `
        SELECT l.target_id AS booking_intent_id
        FROM group_decision_links l
        JOIN booking_options bo ON bo.id = ? AND bo.booking_intent_id = l.target_id
        JOIN booking_intents bi ON bi.id = l.target_id AND bi.trip_id = ?
        WHERE l.decision_id = ? AND l.target_type = 'booking_intent'
        LIMIT 1
      `,
      )
      .get<{ booking_intent_id: number }>(option.booking_option_id, tripId, decisionId);
    if (!linkedIntent) return;

    await asyncDb
      .prepare(
        `
        UPDATE booking_intents
        SET status = 'approved', updated_at = CURRENT_TIMESTAMP
        WHERE trip_id = ? AND id = ? AND status NOT IN ('archived', 'pending_checkout', 'booked')
      `,
      )
      .run(tripId, linkedIntent.booking_intent_id);
  }

  private async assertLinksBelongToTrip(tripId: string, links: NormalizedLink[]): Promise<void> {
    for (const link of links) {
      const exists = await this.findLinkedTarget(tripId, link);
      if (!exists) {
        throw new GroupDecisionInputError(`Linked ${link.targetType} was not found on this trip`);
      }
    }
  }

  private async findLinkedTarget(tripId: string, link: NormalizedLink): Promise<boolean> {
    switch (link.targetType) {
      case 'trip':
        return !!(await asyncDb.prepare('SELECT id FROM trips WHERE id = ? AND id = ?').get(link.targetId, tripId));
      case 'day':
        return !!(await asyncDb.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(link.targetId, tripId));
      case 'place':
        return !!(await asyncDb
          .prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?')
          .get(link.targetId, tripId));
      case 'reservation':
        return !!(await asyncDb
          .prepare('SELECT id FROM reservations WHERE id = ? AND trip_id = ?')
          .get(link.targetId, tripId));
      case 'packing_item':
        return !!(await asyncDb
          .prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?')
          .get(link.targetId, tripId));
      case 'booking_intent':
        return !!(await asyncDb
          .prepare('SELECT id FROM booking_intents WHERE id = ? AND trip_id = ?')
          .get(link.targetId, tripId));
    }
  }
}
