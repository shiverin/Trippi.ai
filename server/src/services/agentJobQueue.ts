import { asyncDb } from '../db/asyncDatabase';

export const AGENT_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'archived'] as const;

export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number];

export interface AgentJob<TPayload = unknown, TResultMetadata = unknown> {
  id: number;
  type: string;
  payload: TPayload;
  status: AgentJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  resultMetadata: TResultMetadata | null;
  idempotencyKey: string | null;
  tripId: number | null;
  lockedBy: string | null;
  lockedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface AgentJobRow {
  id: number | bigint | string;
  type: string;
  payload: string | null;
  status: AgentJobStatus;
  attempts: number | string;
  max_attempts: number | string;
  next_run_at: string;
  last_error: string | null;
  result_metadata: string | null;
  idempotency_key: string | null;
  trip_id: number | string | null;
  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  archived_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

type DateInput = Date | string | number;

export interface EnqueueAgentJobInput<TPayload = unknown> {
  type: string;
  payload?: TPayload;
  idempotencyKey?: string | null;
  tripId?: number | null;
  maxAttempts?: number;
  nextRunAt?: DateInput;
}

export interface ClaimAgentJobOptions {
  workerId: string;
  now?: DateInput;
  staleAfterMs?: number;
}

export interface FinishAgentJobOptions {
  now?: DateInput;
}

export interface CompleteAgentJobOptions extends FinishAgentJobOptions {
  resultMetadata?: unknown;
}

export interface FailAgentJobOptions extends FinishAgentJobOptions {
  retryDelayMs?: number | ((job: AgentJob) => number);
  forceTerminal?: boolean;
  resultMetadata?: unknown;
}

export interface CancelAgentJobOptions extends FinishAgentJobOptions {
  resultMetadata?: unknown;
  includeRunning?: boolean;
}

export type ArchiveAgentJobOptions = FinishAgentJobOptions;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_STORED_ERROR_CHARS = 4000;

function toDbTimestamp(input: DateInput = Date.now()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid agent job timestamp: ${String(input)}`);
  return date.toISOString();
}

function addMs(input: DateInput, ms: number): string {
  const base = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(base)) throw new Error(`Invalid agent job timestamp: ${String(input)}`);
  return new Date(base + ms).toISOString();
}

function parseJson(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown, fallback: unknown): string {
  const serialized = JSON.stringify(value ?? fallback);
  return serialized === undefined ? JSON.stringify(fallback) : serialized;
}

function nullableJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return stringifyJson(value, {});
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > MAX_STORED_ERROR_CHARS ? raw.slice(0, MAX_STORED_ERROR_CHARS) : raw;
}

function retryDelayFor(job: AgentJob, option?: number | ((job: AgentJob) => number)): number {
  const value = typeof option === 'function' ? option(job) : option;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return Math.min(60_000 * 2 ** Math.max(0, job.attempts - 1), 15 * 60_000);
}

function mapAgentJobRow<TPayload = unknown, TResultMetadata = unknown>(
  row: AgentJobRow,
): AgentJob<TPayload, TResultMetadata> {
  return {
    id: Number(row.id),
    type: row.type,
    payload: parseJson(row.payload, {}) as TPayload,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    resultMetadata: parseJson(row.result_metadata, null) as TResultMetadata | null,
    idempotencyKey: row.idempotency_key,
    tripId: toNullableNumber(row.trip_id),
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelledAt: row.cancelled_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getRawAgentJob(jobId: number): Promise<AgentJobRow | undefined> {
  return asyncDb.prepare('SELECT * FROM agent_jobs WHERE id = ?').get<AgentJobRow>(jobId);
}

export async function getAgentJob<TPayload = unknown, TResultMetadata = unknown>(
  jobId: number,
): Promise<AgentJob<TPayload, TResultMetadata> | null> {
  const row = await getRawAgentJob(jobId);
  return row ? mapAgentJobRow<TPayload, TResultMetadata>(row) : null;
}

export async function enqueueAgentJob<TPayload = unknown>(
  input: EnqueueAgentJobInput<TPayload>,
): Promise<AgentJob<TPayload>> {
  const type = input.type.trim();
  if (!type) throw new Error('Agent job type is required');

  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const now = toDbTimestamp();
  const nextRunAt = toDbTimestamp(input.nextRunAt ?? now);
  const payload = stringifyJson(input.payload ?? {}, {});
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const tripId = input.tripId ?? null;

  const result = await asyncDb
    .prepare(
      `
        INSERT OR IGNORE INTO agent_jobs (
          type, payload, status, attempts, max_attempts, next_run_at,
          idempotency_key, trip_id, created_at, updated_at
        )
        VALUES (?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(type, payload, maxAttempts, nextRunAt, idempotencyKey, tripId, now, now);

  if (result.changes > 0) {
    const inserted = await getAgentJob<TPayload>(Number(result.lastInsertRowid));
    if (inserted) return inserted;
  }

  if (idempotencyKey) {
    const existing = await asyncDb
      .prepare('SELECT * FROM agent_jobs WHERE type = ? AND idempotency_key = ?')
      .get<AgentJobRow>(type, idempotencyKey);
    if (existing) return mapAgentJobRow<TPayload>(existing);
  }

  throw new Error('Failed to enqueue agent job');
}

export async function claimNextAgentJob<TPayload = unknown>(
  options: ClaimAgentJobOptions,
): Promise<AgentJob<TPayload> | null> {
  const now = toDbTimestamp(options.now ?? Date.now());
  const staleBefore = addMs(now, -(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));

  const claim = asyncDb.transaction(async () => {
    await asyncDb
      .prepare(
        `
          UPDATE agent_jobs
          SET status = 'failed',
              last_error = 'Job lease expired after max attempts',
              finished_at = ?,
              locked_by = NULL,
              locked_at = NULL,
              updated_at = ?
          WHERE status = 'running'
            AND locked_at IS NOT NULL
            AND locked_at <= ?
            AND attempts >= max_attempts
        `,
      )
      .run(now, now, staleBefore);

    const row = await asyncDb
      .prepare(
        `
          SELECT * FROM agent_jobs
          WHERE attempts < max_attempts
            AND (
              (status = 'queued' AND next_run_at <= ?)
              OR (status = 'running' AND locked_at IS NOT NULL AND locked_at <= ?)
            )
          ORDER BY next_run_at ASC, created_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get<AgentJobRow>(now, staleBefore);

    if (!row) return null;

    const result = await asyncDb
      .prepare(
        `
          UPDATE agent_jobs
          SET status = 'running',
              attempts = attempts + 1,
              locked_by = ?,
              locked_at = ?,
              started_at = COALESCE(started_at, ?),
              updated_at = ?
          WHERE id = ?
            AND attempts < max_attempts
            AND (
              (status = 'queued' AND next_run_at <= ?)
              OR (status = 'running' AND locked_at IS NOT NULL AND locked_at <= ?)
            )
        `,
      )
      .run(options.workerId, now, now, now, row.id, now, staleBefore);

    if (result.changes === 0) return null;
    return getRawAgentJob(Number(row.id));
  });

  const row = await claim();
  return row ? mapAgentJobRow<TPayload>(row) : null;
}

export async function completeAgentJob<TResultMetadata = unknown>(
  job: AgentJob,
  options: CompleteAgentJobOptions = {},
): Promise<AgentJob<unknown, TResultMetadata> | null> {
  const now = toDbTimestamp(options.now ?? Date.now());
  await asyncDb
    .prepare(
      `
        UPDATE agent_jobs
        SET status = 'succeeded',
            last_error = NULL,
            result_metadata = ?,
            finished_at = ?,
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'running'
      `,
    )
    .run(nullableJson(options.resultMetadata), now, now, job.id);

  return getAgentJob<unknown, TResultMetadata>(job.id);
}

export async function failAgentJob(
  job: AgentJob,
  error: unknown,
  options: FailAgentJobOptions = {},
): Promise<AgentJob | null> {
  const nowInput = options.now ?? Date.now();
  const now = toDbTimestamp(nowInput);
  const message = errorMessage(error);
  const shouldRetry = !options.forceTerminal && job.attempts < job.maxAttempts;
  const nextStatus: AgentJobStatus = shouldRetry ? 'queued' : 'failed';
  const nextRunAt = shouldRetry ? addMs(nowInput, retryDelayFor(job, options.retryDelayMs)) : job.nextRunAt;

  await asyncDb
    .prepare(
      `
        UPDATE agent_jobs
        SET status = ?,
            next_run_at = ?,
            last_error = ?,
            result_metadata = COALESCE(?, result_metadata),
            finished_at = CASE WHEN ? = 'failed' THEN ? ELSE finished_at END,
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'running'
      `,
    )
    .run(nextStatus, nextRunAt, message, nullableJson(options.resultMetadata), nextStatus, now, now, job.id);

  return getAgentJob(job.id);
}

export async function cancelAgentJob(
  jobId: number,
  reason = 'Job cancelled',
  options: CancelAgentJobOptions = {},
): Promise<AgentJob | null> {
  const now = toDbTimestamp(options.now ?? Date.now());
  const statuses = options.includeRunning ? "('queued', 'running')" : "('queued')";

  await asyncDb
    .prepare(
      `
        UPDATE agent_jobs
        SET status = 'cancelled',
            last_error = ?,
            result_metadata = COALESCE(?, result_metadata),
            cancelled_at = ?,
            finished_at = ?,
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
        WHERE id = ? AND status IN ${statuses}
      `,
    )
    .run(reason, nullableJson(options.resultMetadata), now, now, now, jobId);

  return getAgentJob(jobId);
}

export async function archiveAgentJob(jobId: number, options: ArchiveAgentJobOptions = {}): Promise<AgentJob | null> {
  const now = toDbTimestamp(options.now ?? Date.now());
  await asyncDb
    .prepare(
      `
        UPDATE agent_jobs
        SET status = 'archived',
            archived_at = ?,
            updated_at = ?
        WHERE id = ? AND status IN ('succeeded', 'failed', 'cancelled')
      `,
    )
    .run(now, now, jobId);

  return getAgentJob(jobId);
}

export async function isAgentJobTripActive(job: Pick<AgentJob, 'tripId'>): Promise<boolean> {
  if (!job.tripId) return true;
  const trip = await asyncDb
    .prepare('SELECT is_archived FROM trips WHERE id = ?')
    .get<{ is_archived: number | string }>(job.tripId);
  return !!trip && Number(trip.is_archived) === 0;
}
