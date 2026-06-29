import { performance } from 'node:perf_hooks';

type PerfMeta = Record<string, unknown>;

let traceSequence = 0;

function isPerfLoggingEnabled(): boolean {
  return process.env.TRIPPI_PERF_LOG === '1' || process.env.MCP_PERF_LOG === '1';
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function cleanMeta(meta: PerfMeta | undefined): PerfMeta | undefined {
  if (!meta) return undefined;
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && typeof value !== 'function'),
  );
}

export class PerfTrace {
  readonly enabled: boolean;

  private readonly id: string;
  private readonly startedAt = performance.now();

  constructor(
    private readonly scope: string,
    meta?: PerfMeta,
  ) {
    this.enabled = isPerfLoggingEnabled();
    this.id = `${Date.now().toString(36)}-${++traceSequence}`;
    this.event('start', meta);
  }

  event(name: string, meta?: PerfMeta): void {
    if (!this.enabled) return;
    const payload = {
      traceId: this.id,
      scope: this.scope,
      event: name,
      elapsedMs: roundMs(performance.now() - this.startedAt),
      ...cleanMeta(meta),
    };
    console.info(`[perf] ${JSON.stringify(payload)}`);
  }

  async measure<T>(name: string, fn: () => Promise<T>, meta?: PerfMeta): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.event(name, { ...meta, durationMs: roundMs(performance.now() - start), success: true });
      return result;
    } catch (err) {
      this.event(name, {
        ...meta,
        durationMs: roundMs(performance.now() - start),
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  measureSync<T>(name: string, fn: () => T, meta?: PerfMeta): T {
    const start = performance.now();
    try {
      const result = fn();
      this.event(name, { ...meta, durationMs: roundMs(performance.now() - start), success: true });
      return result;
    } catch (err) {
      this.event(name, {
        ...meta,
        durationMs: roundMs(performance.now() - start),
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  finish(meta?: PerfMeta): void {
    this.event('finish', { ...meta, totalMs: roundMs(performance.now() - this.startedAt) });
  }
}

export function createPerfTrace(scope: string, meta?: PerfMeta): PerfTrace {
  return new PerfTrace(scope, meta);
}
