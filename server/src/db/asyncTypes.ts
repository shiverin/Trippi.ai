export interface AsyncRunResult {
  changes: number;
  lastInsertRowid: number | bigint | string;
}

export interface AsyncStatement {
  get<T = unknown>(...args: unknown[]): Promise<T | undefined>;
  all<T = unknown>(...args: unknown[]): Promise<T[]>;
  run(...args: unknown[]): Promise<AsyncRunResult>;
}

export interface AsyncTransaction<Args extends unknown[], Result> {
  (...args: Args): Promise<Awaited<Result>>;
  default: (...args: Args) => Promise<Awaited<Result>>;
  deferred: (...args: Args) => Promise<Awaited<Result>>;
  immediate: (...args: Args) => Promise<Awaited<Result>>;
  exclusive: (...args: Args) => Promise<Awaited<Result>>;
}

export interface AsyncDb {
  prepare(sql: string): AsyncStatement;
  exec(sql: string): Promise<this>;
  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result | Promise<Result>,
  ): AsyncTransaction<Args, Result>;
  pragma(source: string): Promise<unknown[]>;
  close(): Promise<void>;
}
