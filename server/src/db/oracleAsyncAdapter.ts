import type { AsyncDb, AsyncRunResult, AsyncStatement, AsyncTransaction } from './asyncTypes';
import { OracleAutonomousConfig, getOracleAutonomousConfigFromEnv } from './oracleAutonomous';
import { buildOracleBinds, translateSqlPlaceholders, TranslatedSql } from './oracleNativeAdapter';

import { AsyncLocalStorage } from 'async_hooks';
import oracledb from 'oracledb';

type OracleRow = Record<string, unknown>;
type SqliteInsertValues = NonNullable<TranslatedSql['sqliteReplace']>;

interface OracleConstraintColumnRow {
  CONSTRAINT_NAME: string;
  CONSTRAINT_TYPE: 'P' | 'U';
  COLUMN_NAME: string;
  POSITION: number;
}

export interface OracleAsyncAdapterOptions {
  config?: OracleAutonomousConfig;
  env?: NodeJS.ProcessEnv;
  poolMin?: number;
  poolMax?: number;
  poolIncrement?: number;
}

interface TxContext {
  connection: oracledb.Connection;
}

const SQL_JOIN_WORDS = new Set(['CROSS', 'FULL', 'INNER', 'JOIN', 'LEFT', 'LIMIT', 'ON', 'ORDER', 'RIGHT', 'WHERE']);

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function normalizeColumnName(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase() : name;
}

function normalizeRow(row: Record<string, unknown>): OracleRow {
  const normalized: OracleRow = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeColumnName(key)] = normalizeValue(value);
  }
  return normalized;
}

function normalizeRows(rows: unknown[] | undefined): OracleRow[] {
  return (rows ?? []).map((row) => normalizeRow(row as Record<string, unknown>));
}

function withSqlContext(err: unknown, sql: string): Error {
  const source = err instanceof Error ? err : new Error(String(err));
  const wrapped = new Error(`${source.message}\nSQL: ${sql}`);
  wrapped.name = source.name;
  if (source.stack) wrapped.stack = `${wrapped.name}: ${wrapped.message}\nCaused by: ${source.stack}`;
  const sourceWithOracleFields = source as Error & { code?: string | number; errorNum?: number; offset?: number };
  const wrappedWithOracleFields = wrapped as Error & { code?: string | number; errorNum?: number; offset?: number };
  if (sourceWithOracleFields.code !== undefined) wrappedWithOracleFields.code = sourceWithOracleFields.code;
  if (sourceWithOracleFields.errorNum !== undefined) wrappedWithOracleFields.errorNum = sourceWithOracleFields.errorNum;
  if (sourceWithOracleFields.offset !== undefined) wrappedWithOracleFields.offset = sourceWithOracleFields.offset;
  return wrapped;
}

function skipQuoted(sql: string, index: number, quote: string): number {
  let i = index + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

function skipUntil(sql: string, index: number, terminator: string): number {
  const end = sql.indexOf(terminator, index + terminator.length);
  return end === -1 ? sql.length : end + terminator.length;
}

function skipWhitespace(sql: string, index: number): number {
  let i = index;
  while (i < sql.length && /\s/.test(sql[i])) i++;
  return i;
}

function skipSqlQuoted(sql: string, index: number): number {
  const quote = sql[index];
  if (quote === "'" || quote === '"') return skipQuoted(sql, index, quote);
  if (quote === '`') return skipUntil(sql, index, '`');
  if (quote === '[') return skipUntil(sql, index, ']');
  return index + 1;
}

function readBalancedGroup(sql: string, openIndex: number): { content: string; end: number } | null {
  if (sql[openIndex] !== '(') return null;

  let depth = 1;
  let i = openIndex + 1;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      i = skipSqlQuoted(sql, i);
      continue;
    }
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i + 2);
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i = skipUntil(sql, i, '*/');
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth === 0) return { content: sql.slice(openIndex + 1, i), end: i + 1 };
    }
    i++;
  }

  return null;
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let i = 0;

  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1];
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      i = skipSqlQuoted(input, i);
      continue;
    }
    if (char === '-' && next === '-') {
      const newline = input.indexOf('\n', i + 2);
      i = newline === -1 ? input.length : newline + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i = skipUntil(input, i, '*/');
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && char === ',') {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }

  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"');
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed.slice(1, -1).replace(/``/g, '`');
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

function quoteOracleIdentifier(identifier: string): string {
  const normalized = normalizeIdentifier(identifier).toUpperCase();
  if (!/^[A-Z][A-Z0-9_$#]*$/.test(normalized)) {
    throw new Error(`OracleAsyncAdapter cannot safely translate SQLite identifier "${identifier}".`);
  }
  return `"${normalized}"`;
}

function oracleObjectName(identifier: string): string {
  return normalizeIdentifier(identifier).toUpperCase();
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "'" || char === '"') {
      i = skipQuoted(sql, i, char);
      continue;
    }
    if (char === '`') {
      i = skipUntil(sql, i, '`');
      continue;
    }
    if (char === '[') {
      i = skipUntil(sql, i, ']');
      continue;
    }
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i + 2);
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i = skipUntil(sql, i, '*/');
      continue;
    }
    if (char === ';') {
      const statement = sql.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
    i++;
  }

  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function transactionControl(statement: string): 'begin' | 'commit' | 'rollback' | null {
  const normalized = statement.trim().replace(/\s+/g, ' ').toUpperCase();
  if (/^BEGIN( TRANSACTION| DEFERRED| IMMEDIATE| EXCLUSIVE)?$/.test(normalized)) return 'begin';
  if (normalized === 'COMMIT' || normalized === 'COMMIT TRANSACTION') return 'commit';
  if (normalized === 'ROLLBACK' || normalized === 'ROLLBACK TRANSACTION') return 'rollback';
  return null;
}

function isIgnoredPragma(statement: string): boolean {
  return /^PRAGMA\s+/i.test(statement.trim());
}

function isUniqueConstraintError(err: unknown): boolean {
  const error = err as { errorNum?: number; code?: string | number; message?: string };
  return error?.errorNum === 1 || error?.code === 'ORA-00001' || /ORA-00001/.test(error?.message ?? '');
}

function isInvalidReturningIdentityError(err: unknown): boolean {
  const error = err as { errorNum?: number; code?: string | number; message?: string };
  const message = error?.message ?? '';
  return (
    error?.errorNum === 904 ||
    error?.errorNum === 933 ||
    error?.code === 'ORA-00904' ||
    error?.code === 'ORA-00933' ||
    /ORA-00904|ORA-00933/.test(message)
  );
}

function parseSimpleInsertColumns(sql: string): { columns: string[]; values: string[] } | null {
  const trimmed = sql.trim().replace(/;$/, '').trim();
  const match = /^INSERT\s+INTO\s+[A-Za-z_][A-Za-z0-9_$#]*\s*/i.exec(trimmed);
  if (!match) return null;

  let index = skipWhitespace(trimmed, match[0].length);
  const columnsGroup = readBalancedGroup(trimmed, index);
  if (!columnsGroup) return null;
  const columns = splitTopLevel(columnsGroup.content).map(normalizeIdentifier);
  index = skipWhitespace(trimmed, columnsGroup.end);
  if (trimmed.slice(index, index + 6).toUpperCase() !== 'VALUES') return null;
  index = skipWhitespace(trimmed, index + 6);
  const valuesGroup = readBalancedGroup(trimmed, index);
  if (!valuesGroup) return null;
  const values = splitTopLevel(valuesGroup.content);
  return columns.length === values.length ? { columns, values } : null;
}

function literalOrBindValue(expression: string, binds: Record<string, unknown>): unknown {
  const trimmed = expression.trim();
  const bindMatch = /^:([A-Za-z_][A-Za-z0-9_$#]*)$/.exec(trimmed);
  if (bindMatch) return binds[bindMatch[1]];
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return undefined;
}

function tableAliases(sql: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const pattern = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_$#]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_$#]*))?/gi;
  for (const match of sql.matchAll(pattern)) {
    const tableName = match[1];
    const aliasCandidate = match[2];
    const alias = aliasCandidate && !SQL_JOIN_WORDS.has(aliasCandidate.toUpperCase()) ? aliasCandidate : tableName;
    aliases.set(alias, tableName);
  }
  return aliases;
}

async function oracleColumnsForTable(
  oracle: oracledb.Connection,
  cache: Map<string, string[]>,
  tableName: string,
): Promise<string[]> {
  const key = oracleObjectName(tableName);
  const cached = cache.get(key);
  if (cached) return cached;

  const result = await oracle.execute<{ COLUMN_NAME: string }>(
    `
      SELECT column_name
      FROM user_tab_columns
      WHERE table_name = :tableName
      ORDER BY column_id
    `,
    { tableName: key },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const columns = (result.rows ?? []).map((row) => row.COLUMN_NAME);
  cache.set(key, columns);
  return columns;
}

async function expandAliasStars(
  oracle: oracledb.Connection,
  cache: Map<string, string[]>,
  sql: string,
): Promise<string> {
  if (!/\b[A-Za-z_][A-Za-z0-9_$#]*\.\*/.test(sql)) return sql;

  const aliases = tableAliases(sql);
  let translated = '';
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "'" || char === '"') {
      const end = skipQuoted(sql, i, char);
      translated += sql.slice(i, end);
      i = end;
      continue;
    }
    if (char === '`') {
      const end = skipUntil(sql, i, '`');
      translated += sql.slice(i, end);
      i = end;
      continue;
    }
    if (char === '[') {
      const end = skipUntil(sql, i, ']');
      translated += sql.slice(i, end);
      i = end;
      continue;
    }
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i + 2);
      const end = newline === -1 ? sql.length : newline + 1;
      translated += sql.slice(i, end);
      i = end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = skipUntil(sql, i, '*/');
      translated += sql.slice(i, end);
      i = end;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = i;
      i += 1;
      while (i < sql.length && /[A-Za-z0-9_$#]/.test(sql[i])) i += 1;
      const alias = sql.slice(start, i);
      if (sql.slice(i, i + 2) === '.*' && aliases.has(alias)) {
        const columns = await oracleColumnsForTable(oracle, cache, aliases.get(alias)!);
        translated += columns
          .map((column) => `${alias}.${quoteOracleIdentifier(column)} AS "${column.toLowerCase()}"`)
          .join(', ');
        i += 2;
        continue;
      }
      translated += alias;
      continue;
    }

    translated += char;
    i++;
  }

  return translated;
}

async function executeInsertWithIdentityReturn(
  oracle: oracledb.Connection,
  sql: string,
  binds: Record<string, unknown>,
  inTransaction: boolean,
): Promise<AsyncRunResult | null> {
  if (!/^\s*INSERT\s+INTO\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return null;

  const parsed = parseSimpleInsertColumns(sql);
  if (!parsed) return null;

  const explicitIdIndex = parsed.columns.findIndex((column) => column.toLowerCase() === 'id');
  if (explicitIdIndex !== -1) {
    const result = await oracle.execute(sql, binds, { autoCommit: !inTransaction });
    const explicitId = literalOrBindValue(parsed.values[explicitIdIndex], binds);
    return {
      changes: Number(result.rowsAffected ?? 0),
      lastInsertRowid: typeof explicitId === 'number' || typeof explicitId === 'string' ? explicitId : 0,
    };
  }

  const returningBind = 'oracleLastInsertId';
  try {
    const result = await oracle.execute(
      `${sql.replace(/;$/, '')} RETURNING ${quoteOracleIdentifier('id')} INTO :${returningBind}`,
      {
        ...binds,
        [returningBind]: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
      },
      { autoCommit: !inTransaction },
    );
    const outBinds = result.outBinds as Record<string, unknown> | undefined;
    const returned = outBinds?.[returningBind];
    const returnedValue = Array.isArray(returned) ? returned[0] : returned;
    return {
      changes: Number(result.rowsAffected ?? 0),
      lastInsertRowid: typeof returnedValue === 'number' || typeof returnedValue === 'string' ? returnedValue : 0,
    };
  } catch (err) {
    if (!isInvalidReturningIdentityError(err)) throw err;
    return null;
  }
}

async function uniqueColumnsForReplace(oracle: oracledb.Connection, insert: SqliteInsertValues): Promise<string[]> {
  const inserted = new Set(insert.columns.map((column) => oracleObjectName(column)));
  const result = await oracle.execute<OracleConstraintColumnRow>(
    `
      SELECT c.constraint_name, c.constraint_type, cc.column_name, cc.position
      FROM user_constraints c
      JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name AND cc.owner = c.owner
      WHERE c.table_name = :tableName
        AND c.constraint_type IN ('P', 'U')
      ORDER BY CASE c.constraint_type WHEN 'P' THEN 0 ELSE 1 END, c.constraint_name, cc.position
    `,
    { tableName: oracleObjectName(insert.tableName) },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const grouped = new Map<string, OracleConstraintColumnRow[]>();
  for (const row of result.rows ?? []) {
    const key = `${row.CONSTRAINT_TYPE}:${row.CONSTRAINT_NAME}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const candidates = [...grouped.values()]
    .map((rows) => rows.sort((a, b) => Number(a.POSITION) - Number(b.POSITION)).map((row) => row.COLUMN_NAME))
    .filter((columns) => columns.length > 0 && columns.every((column) => inserted.has(column)));

  if (candidates.length === 0) {
    throw new Error(
      `OracleAsyncAdapter cannot translate INSERT OR REPLACE for ${insert.tableName}; no primary or unique key is fully present in the insert column list.`,
    );
  }

  candidates.sort((a, b) => a.length - b.length);
  return candidates[0].map((column) => column.toLowerCase());
}

function buildReplaceMergeSql(insert: SqliteInsertValues, keyColumns: string[]): string {
  const keySet = new Set(keyColumns.map((column) => column.toLowerCase()));
  const updateColumns = insert.columns.filter((column) => !keySet.has(column.toLowerCase()));
  if (updateColumns.length === 0) {
    throw new Error(
      `OracleAsyncAdapter cannot translate INSERT OR REPLACE for ${insert.tableName}; every inserted column is part of the conflict key.`,
    );
  }

  const selectList = insert.values
    .map((value, index) => `${value} AS ${quoteOracleIdentifier(insert.columns[index])}`)
    .join(', ');
  const onClause = keyColumns
    .map((column) => `dst.${quoteOracleIdentifier(column)} = src.${quoteOracleIdentifier(column)}`)
    .join(' AND ');
  const updateClause = updateColumns
    .map((column) => `dst.${quoteOracleIdentifier(column)} = src.${quoteOracleIdentifier(column)}`)
    .join(', ');
  const insertColumns = insert.columns.map(quoteOracleIdentifier).join(', ');
  const insertValues = insert.columns.map((column) => `src.${quoteOracleIdentifier(column)}`).join(', ');

  return [
    `MERGE INTO ${quoteOracleIdentifier(insert.tableName)} dst`,
    `USING (SELECT ${selectList} FROM dual) src`,
    `ON (${onClause})`,
    `WHEN MATCHED THEN UPDATE SET ${updateClause}`,
    `WHEN NOT MATCHED THEN INSERT (${insertColumns}) VALUES (${insertValues})`,
  ].join(' ');
}

class OracleAsyncStatement implements AsyncStatement {
  constructor(
    private readonly adapter: OracleAsyncAdapter,
    private readonly translated: TranslatedSql,
  ) {}

  async get<T = unknown>(...args: unknown[]): Promise<T | undefined> {
    if (this.translated.noop) return undefined;
    return this.adapter.query<T | undefined>('get', this.translated, args);
  }

  async all<T = unknown>(...args: unknown[]): Promise<T[]> {
    if (this.translated.noop) return [];
    return this.adapter.query<T[]>('all', this.translated, args);
  }

  async run(...args: unknown[]): Promise<AsyncRunResult> {
    if (this.translated.noop) return { changes: 0, lastInsertRowid: 0 };
    return this.adapter.query<AsyncRunResult>('run', this.translated, args);
  }
}

export class OracleAsyncAdapter implements AsyncDb {
  private pool: oracledb.Pool | null = null;
  private readonly txStorage = new AsyncLocalStorage<TxContext>();
  private readonly columnCache = new Map<string, string[]>();
  private readonly config: OracleAutonomousConfig;
  private readonly poolMin: number;
  private readonly poolMax: number;
  private readonly poolIncrement: number;

  constructor(options: OracleAsyncAdapterOptions = {}) {
    const env = options.env ?? process.env;
    const config = options.config ?? getOracleAutonomousConfigFromEnv(env);
    if (!config) {
      throw new Error(
        'Missing Oracle configuration for OracleAsyncAdapter. Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
      );
    }

    oracledb.fetchAsString = [oracledb.CLOB];
    this.config = config;
    this.poolMin = options.poolMin ?? Number(env.ORACLE_POOL_MIN || 1);
    this.poolMax = options.poolMax ?? Number(env.ORACLE_POOL_MAX || 4);
    this.poolIncrement = options.poolIncrement ?? Number(env.ORACLE_POOL_INCREMENT || 1);
  }

  prepare(sql: string): AsyncStatement {
    return new OracleAsyncStatement(this, translateSqlPlaceholders(sql));
  }

  async exec(sql: string): Promise<this> {
    await this.withConnection(async (connection, inTransaction) => {
      for (const statement of splitSqlStatements(sql)) {
        const control = transactionControl(statement);
        if (control === 'commit') {
          await connection.commit();
          continue;
        }
        if (control === 'rollback') {
          await connection.rollback();
          continue;
        }
        if (control === 'begin' || isIgnoredPragma(statement)) continue;
        await connection.execute(statement, {}, { autoCommit: !inTransaction });
      }
    });
    return this;
  }

  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result | Promise<Result>,
  ): AsyncTransaction<Args, Result> {
    const run = async (...args: Args): Promise<Awaited<Result>> => {
      const existing = this.txStorage.getStore();
      if (existing) return (await fn(...args)) as Awaited<Result>;

      const pool = await this.getPool();
      const connection = await pool.getConnection();
      return (await this.txStorage.run({ connection }, async () => {
        try {
          const result = await fn(...args);
          await connection.commit();
          return result as Awaited<Result>;
        } catch (err) {
          try {
            await connection.rollback();
          } catch {
            /* preserve original error */
          }
          throw err;
        } finally {
          await connection.close();
        }
      })) as Awaited<Result>;
    };

    return Object.assign(run, {
      default: run,
      deferred: run,
      immediate: run,
      exclusive: run,
    });
  }

  async pragma(_source: string): Promise<unknown[]> {
    return [];
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    const pool = this.pool;
    this.pool = null;
    await pool.close(0);
  }

  async query<T>(mode: 'get' | 'all' | 'run', translated: TranslatedSql, args: unknown[]): Promise<T> {
    const binds = buildOracleBinds(args, translated);
    return this.withConnection(async (connection, inTransaction) => {
      if (mode === 'run') return this.executeRun(connection, translated, binds, inTransaction) as T;

      const sql = await expandAliasStars(connection, this.columnCache, translated.sql);
      try {
        const result = await connection.execute(sql, binds, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: mode === 'get' ? 1 : undefined,
        });
        const rows = normalizeRows(result.rows as unknown[] | undefined);
        return (mode === 'get' ? rows[0] : rows) as T;
      } catch (err) {
        throw withSqlContext(err, sql);
      }
    });
  }

  private async getPool(): Promise<oracledb.Pool> {
    if (this.pool) return this.pool;

    const attrs: oracledb.PoolAttributes = {
      user: this.config.user,
      password: this.config.password,
      connectString: this.config.connectString,
      poolMin: this.poolMin,
      poolMax: this.poolMax,
      poolIncrement: this.poolIncrement,
    };
    if (this.config.walletLocation) {
      attrs.configDir = this.config.walletLocation;
      attrs.walletLocation = this.config.walletLocation;
    }
    if (this.config.walletPassword) attrs.walletPassword = this.config.walletPassword;

    this.pool = await oracledb.createPool(attrs);
    return this.pool;
  }

  private async withConnection<T>(
    fn: (connection: oracledb.Connection, inTransaction: boolean) => Promise<T>,
  ): Promise<T> {
    const tx = this.txStorage.getStore();
    if (tx) return fn(tx.connection, true);

    const pool = await this.getPool();
    const connection = await pool.getConnection();
    try {
      return await fn(connection, false);
    } finally {
      await connection.close();
    }
  }

  private async executeReplaceRun(
    connection: oracledb.Connection,
    insert: SqliteInsertValues,
    binds: Record<string, unknown>,
    inTransaction: boolean,
  ): Promise<AsyncRunResult> {
    const keyColumns = await uniqueColumnsForReplace(connection, insert);
    const sql = buildReplaceMergeSql(insert, keyColumns);
    const result = await connection.execute(sql, binds, { autoCommit: !inTransaction });
    return {
      changes: Number(result.rowsAffected ?? 0),
      lastInsertRowid: 0,
    };
  }

  private async executeRun(
    connection: oracledb.Connection,
    translated: TranslatedSql,
    binds: Record<string, unknown>,
    inTransaction: boolean,
  ): Promise<AsyncRunResult> {
    if (translated.sqliteReplace) {
      return this.executeReplaceRun(connection, translated.sqliteReplace, binds, inTransaction);
    }

    try {
      const identityResult = await executeInsertWithIdentityReturn(connection, translated.sql, binds, inTransaction);
      if (identityResult) return identityResult;
    } catch (err) {
      if (translated.sqliteConflictAction === 'ignore' && isUniqueConstraintError(err)) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      throw withSqlContext(err, translated.sql);
    }

    let result: oracledb.Result<unknown>;
    try {
      result = await connection.execute(translated.sql, binds, { autoCommit: !inTransaction });
    } catch (err) {
      if (translated.sqliteConflictAction === 'ignore' && isUniqueConstraintError(err)) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      throw withSqlContext(err, translated.sql);
    }

    return {
      changes: Number(result.rowsAffected ?? 0),
      lastInsertRowid: 0,
    };
  }
}

export default OracleAsyncAdapter;
