import {
  AgentJob,
  cancelAgentJob,
  claimNextAgentJob,
  completeAgentJob,
  failAgentJob,
  isAgentJobTripActive,
} from './agentJobQueue';

export interface AgentJobHandlerContext {
  workerId: string;
  signal?: AbortSignal;
  assertTripActive: () => Promise<void>;
}

export type AgentJobHandler<TPayload = unknown> = (
  job: AgentJob<TPayload>,
  context: AgentJobHandlerContext,
) => Promise<unknown> | unknown;

export type AgentJobHandlers = Record<string, AgentJobHandler>;

export type AgentJobProcessResult =
  | { status: 'idle' }
  | { status: 'succeeded'; job: AgentJob }
  | { status: 'retrying'; job: AgentJob; error: string }
  | { status: 'failed'; job: AgentJob; error: string }
  | { status: 'cancelled'; job: AgentJob; reason: string };

export interface ProcessNextAgentJobOptions {
  handlers: AgentJobHandlers;
  workerId?: string;
  now?: Date | string | number;
  staleAfterMs?: number;
  retryDelayMs?: number | ((job: AgentJob) => number);
  signal?: AbortSignal;
}

export interface RunAgentJobWorkerLoopOptions extends Omit<ProcessNextAgentJobOptions, 'now'> {
  pollIntervalMs?: number;
}

export interface DrainAgentJobsOptions extends ProcessNextAgentJobOptions {
  maxJobs?: number;
}

function defaultWorkerId(): string {
  return `agent-worker-${process.pid}`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resultFromFinalJob(job: AgentJob, fallbackError: string): AgentJobProcessResult {
  if (job.status === 'queued') return { status: 'retrying', job, error: job.lastError ?? fallbackError };
  if (job.status === 'succeeded') return { status: 'succeeded', job };
  if (job.status === 'cancelled') return { status: 'cancelled', job, reason: job.lastError ?? 'Job cancelled' };
  return { status: 'failed', job, error: job.lastError ?? fallbackError };
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function processNextAgentJob(options: ProcessNextAgentJobOptions): Promise<AgentJobProcessResult> {
  const workerId = options.workerId ?? defaultWorkerId();
  const now = options.now ?? Date.now();
  const job = await claimNextAgentJob({
    workerId,
    now,
    staleAfterMs: options.staleAfterMs,
  });

  if (!job) return { status: 'idle' };

  if (options.signal?.aborted) {
    const updated = await failAgentJob(job, new Error('Worker aborted before executing job'), {
      now,
      retryDelayMs: 0,
    });
    return resultFromFinalJob(updated ?? job, 'Worker aborted before executing job');
  }

  const assertTripActive = async () => {
    if (await isAgentJobTripActive(job)) return;
    throw new Error(`Trip ${job.tripId} is archived or unavailable`);
  };

  if (!(await isAgentJobTripActive(job))) {
    const reason = `Trip ${job.tripId} is archived or unavailable`;
    const cancelled = await cancelAgentJob(job.id, reason, {
      includeRunning: true,
      now,
      resultMetadata: { reason: 'trip_inactive', tripId: job.tripId },
    });
    return { status: 'cancelled', job: cancelled ?? job, reason };
  }

  const handler = options.handlers[job.type];
  if (!handler) {
    const updated = await failAgentJob(job, new Error(`No handler registered for agent job type "${job.type}"`), {
      forceTerminal: true,
      now,
    });
    const finalJob = updated ?? job;
    return {
      status: 'failed',
      job: finalJob,
      error: finalJob.lastError ?? `No handler registered for agent job type "${job.type}"`,
    };
  }

  try {
    const resultMetadata = await handler(job, {
      workerId,
      signal: options.signal,
      assertTripActive,
    });
    const completed = await completeAgentJob(job, { resultMetadata, now });
    return resultFromFinalJob(completed ?? job, 'Job did not complete');
  } catch (error) {
    const updated = await failAgentJob(job, error, {
      now,
      retryDelayMs: options.retryDelayMs,
    });
    return resultFromFinalJob(updated ?? job, messageFrom(error));
  }
}

export async function drainAgentJobs(options: DrainAgentJobsOptions): Promise<AgentJobProcessResult[]> {
  const maxJobs = Math.max(1, options.maxJobs ?? 100);
  const results: AgentJobProcessResult[] = [];

  for (let i = 0; i < maxJobs; i++) {
    const result = await processNextAgentJob(options);
    results.push(result);
    if (result.status === 'idle') break;
  }

  return results;
}

export async function runAgentJobWorkerLoop(options: RunAgentJobWorkerLoopOptions): Promise<void> {
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 1000);

  while (!options.signal?.aborted) {
    const result = await processNextAgentJob(options);
    if (result.status === 'idle') {
      await sleep(pollIntervalMs, options.signal);
    }
  }
}
