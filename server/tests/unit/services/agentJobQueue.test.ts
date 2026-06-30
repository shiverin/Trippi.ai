import { closeDb, db } from '../../../src/db/database';
import {
  archiveAgentJob,
  cancelAgentJob,
  claimNextAgentJob,
  enqueueAgentJob,
  getAgentJob,
} from '../../../src/services/agentJobQueue';
import { processNextAgentJob, runAgentJobWorkerLoop } from '../../../src/services/agentJobWorker';
import { createTrip, createUser } from '../../helpers/factories';
import { resetTestDb } from '../../helpers/test-db';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-06-30T10:00:00.000Z';

beforeEach(() => {
  resetTestDb(db);
});

afterAll(() => {
  closeDb();
});

describe('agent job queue', () => {
  it('stores queue fields and dedupes by type plus idempotency key', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id, { title: 'Queue Trip' });

    const job = await enqueueAgentJob({
      type: 'trip.summary',
      payload: { tripId: trip.id, mode: 'draft' },
      tripId: trip.id,
      idempotencyKey: `trip:${trip.id}:summary`,
      maxAttempts: 5,
      nextRunAt: NOW,
    });
    const duplicate = await enqueueAgentJob({
      type: 'trip.summary',
      payload: { tripId: trip.id, mode: 'different' },
      tripId: trip.id,
      idempotencyKey: `trip:${trip.id}:summary`,
    });

    expect(duplicate.id).toBe(job.id);
    expect(job).toMatchObject({
      type: 'trip.summary',
      payload: { tripId: trip.id, mode: 'draft' },
      status: 'queued',
      attempts: 0,
      maxAttempts: 5,
      nextRunAt: NOW,
      lastError: null,
      resultMetadata: null,
      idempotencyKey: `trip:${trip.id}:summary`,
      tripId: trip.id,
    });
    expect(db.prepare('SELECT COUNT(*) AS c FROM agent_jobs').get()).toMatchObject({ c: 1 });
  });

  it('claims a due job for only one worker at a time', async () => {
    await enqueueAgentJob({ type: 'one-at-a-time', payload: { ok: true }, nextRunAt: NOW });

    const first = await claimNextAgentJob({ workerId: 'worker-a', now: NOW });
    const second = await claimNextAgentJob({ workerId: 'worker-b', now: NOW });

    expect(first?.status).toBe('running');
    expect(first?.attempts).toBe(1);
    expect(first?.lockedBy).toBe('worker-a');
    expect(second).toBeNull();
  });

  it('processes a queued job successfully and stores result metadata', async () => {
    const job = await enqueueAgentJob({ type: 'success', payload: { value: 42 }, nextRunAt: NOW });

    const result = await processNextAgentJob({
      workerId: 'success-worker',
      now: NOW,
      handlers: {
        success: async (claimed) => {
          const payload = claimed.payload as { value: number };
          return { doubled: payload.value * 2, attempt: claimed.attempts };
        },
      },
    });
    const updated = await getAgentJob<{ value: number }, { doubled: number; attempt: number }>(job.id);

    expect(result.status).toBe('succeeded');
    expect(updated).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      lastError: null,
      resultMetadata: { doubled: 84, attempt: 1 },
      lockedBy: null,
      lockedAt: null,
    });
    expect(updated?.finishedAt).toBe(NOW);
  });

  it('retries failures after next_run_at and then succeeds idempotently', async () => {
    const job = await enqueueAgentJob({ type: 'flaky', payload: { value: 'ok' }, maxAttempts: 2, nextRunAt: NOW });
    const handler = vi.fn(async () => {
      if (handler.mock.calls.length === 1) throw new Error('temporary outage');
      return { recovered: true };
    });

    const first = await processNextAgentJob({
      workerId: 'retry-worker',
      now: NOW,
      retryDelayMs: 1000,
      handlers: { flaky: handler },
    });
    const early = await processNextAgentJob({
      workerId: 'retry-worker',
      now: '2026-06-30T10:00:00.500Z',
      handlers: { flaky: handler },
    });
    const second = await processNextAgentJob({
      workerId: 'retry-worker',
      now: '2026-06-30T10:00:01.000Z',
      handlers: { flaky: handler },
    });
    const updated = await getAgentJob(job.id);

    expect(first.status).toBe('retrying');
    expect(early.status).toBe('idle');
    expect(second.status).toBe('succeeded');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(updated).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      lastError: null,
      resultMetadata: { recovered: true },
    });
  });

  it('marks a job failed when max attempts are exhausted', async () => {
    const job = await enqueueAgentJob({ type: 'terminal-failure', maxAttempts: 1, nextRunAt: NOW });

    const result = await processNextAgentJob({
      workerId: 'failure-worker',
      now: NOW,
      handlers: {
        'terminal-failure': async () => {
          throw new Error('permanent failure');
        },
      },
    });
    const updated = await getAgentJob(job.id);

    expect(result.status).toBe('failed');
    expect(updated).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'permanent failure',
    });
    expect(updated?.finishedAt).toBe(NOW);
  });

  it('skips cancelled jobs and archives terminal jobs', async () => {
    const job = await enqueueAgentJob({ type: 'cancel-me', nextRunAt: NOW });
    const handler = vi.fn();

    const cancelled = await cancelAgentJob(job.id, 'user requested', { now: NOW });
    const result = await processNextAgentJob({
      workerId: 'cancel-worker',
      now: NOW,
      handlers: { 'cancel-me': handler },
    });
    const archived = await archiveAgentJob(job.id, { now: '2026-06-30T10:00:05.000Z' });

    expect(cancelled).toMatchObject({ status: 'cancelled', lastError: 'user requested' });
    expect(result.status).toBe('idle');
    expect(handler).not.toHaveBeenCalled();
    expect(archived).toMatchObject({ status: 'archived', archivedAt: '2026-06-30T10:00:05.000Z' });
  });

  it('cancels trip-scoped jobs before execution when the trip is archived', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id, { title: 'Archived Trip' });
    const job = await enqueueAgentJob({
      type: 'trip-write',
      tripId: trip.id,
      payload: { tripId: trip.id },
      nextRunAt: NOW,
    });
    const handler = vi.fn();
    db.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(trip.id);

    const result = await processNextAgentJob({
      workerId: 'trip-guard-worker',
      now: NOW,
      handlers: { 'trip-write': handler },
    });
    const updated = await getAgentJob(job.id);

    expect(result.status).toBe('cancelled');
    expect(handler).not.toHaveBeenCalled();
    expect(updated).toMatchObject({
      status: 'cancelled',
      lastError: `Trip ${trip.id} is archived or unavailable`,
      resultMetadata: { reason: 'trip_inactive', tripId: trip.id },
    });
  });

  it('runs the cancellable worker loop until the signal is aborted', async () => {
    const job = await enqueueAgentJob({ type: 'looped', payload: { n: 1 } });
    const controller = new AbortController();
    const seen: number[] = [];

    await runAgentJobWorkerLoop({
      workerId: 'loop-worker',
      pollIntervalMs: 1,
      signal: controller.signal,
      handlers: {
        looped: async (claimed) => {
          seen.push(claimed.id);
          controller.abort();
          return { looped: true };
        },
      },
    });

    const updated = await getAgentJob(job.id);
    expect(seen).toEqual([job.id]);
    expect(updated).toMatchObject({ status: 'succeeded', resultMetadata: { looped: true } });
  });
});
