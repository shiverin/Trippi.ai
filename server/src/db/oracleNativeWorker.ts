import { OracleAutonomousConfig, openOracleAutonomousConnection } from './oracleAutonomous';

import oracledb from 'oracledb';
import { parentPort, workerData } from 'worker_threads';

interface OracleNativeWorkerData {
  config: OracleAutonomousConfig;
  controlBuffer: SharedArrayBuffer;
  responseBuffer: SharedArrayBuffer;
}

type WorkerRequest =
  | { id: number; type: 'connect' }
  | { id: number; type: 'close' }
  | { id: number; type: 'exec'; sql: string }
  | {
      id: number;
      type: 'query';
      mode: 'get' | 'all' | 'run';
      sql: string;
      binds: Record<string, unknown>;
      sqliteConflictAction?: 'ignore';
      sqliteReplace?: SqliteInsertValues;
    };

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: {
    name?: string;
    message: string;
    stack?: string;
    code?: string | number;
    errorNum?: number;
    offset?: number;
  };
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | string;
}

interface SqliteInsertValues {
  tableName: string;
  columns: string[];
  values: string[];
}

interface OracleConstraintColumnRow {
  CONSTRAINT_NAME: string;
  CONSTRAINT_TYPE: 'P' | 'U';
  COLUMN_NAME: string;
  POSITION: number;
}

const CONTROL_STATE = 0;
const CONTROL_LENGTH = 1;
const STATE_READY = 1;

const data = workerData as OracleNativeWorkerData;
const control = new Int32Array(data.controlBuffer);
const responseBytes = new Uint8Array(data.responseBuffer);
let connection: oracledb.Connection | null = null;
let inTransaction = false;
const columnCache = new Map<string, string[]>();

oracledb.fetchAsString = [oracledb.CLOB];

function assertParentPort(): NonNullable<typeof parentPort> {
  if (!parentPort) throw new Error('Oracle native worker requires parentPort.');
  return parentPort;
}

async function getConnection(): Promise<oracledb.Connection> {
  if (!connection) connection = await openOracleAutonomousConnection(data.config);
  return connection;
}

function serializeError(err: unknown): WorkerResponse['error'] {
  if (err instanceof Error) {
    const extended = err as Error & { code?: string | number; errorNum?: number; offset?: number };
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: extended.code,
      errorNum: extended.errorNum,
      offset: extended.offset,
    };
  }
  return { message: String(err) };
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

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { __oracleNativeAdapterType: 'buffer', base64: value.toString('base64') };
  }
  if (value instanceof Uint8Array) {
    return { __oracleNativeAdapterType: 'buffer', base64: Buffer.from(value).toString('base64') };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function normalizeColumnName(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase() : name;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeColumnName(key)] = normalizeValue(value);
  }
  return normalized;
}

function normalizeRows(rows: unknown[] | undefined): Record<string, unknown>[] {
  return (rows ?? []).map((row) => normalizeRow(row as Record<string, unknown>));
}

const SQL_JOIN_WORDS = new Set(['CROSS', 'FULL', 'INNER', 'JOIN', 'LEFT', 'LIMIT', 'ON', 'ORDER', 'RIGHT', 'WHERE']);

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

async function oracleColumnsForTable(oracle: oracledb.Connection, tableName: string): Promise<string[]> {
  const key = oracleObjectName(tableName);
  const cached = columnCache.get(key);
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
  columnCache.set(key, columns);
  return columns;
}

async function expandAliasStars(oracle: oracledb.Connection, sql: string): Promise<string> {
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
        const columns = await oracleColumnsForTable(oracle, aliases.get(alias)!);
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

function writeResponse(response: WorkerResponse): void {
  let payload = Buffer.from(JSON.stringify(response), 'utf8');
  if (payload.length > responseBytes.byteLength) {
    payload = Buffer.from(
      JSON.stringify({
        id: response.id,
        ok: false,
        error: {
          name: 'RangeError',
          message: `Oracle native worker response exceeded ${responseBytes.byteLength} bytes. Increase responseBufferBytes or narrow the query.`,
        },
      } satisfies WorkerResponse),
      'utf8',
    );
  }

  responseBytes.set(payload.subarray(0, responseBytes.byteLength));
  Atomics.store(control, CONTROL_LENGTH, Math.min(payload.length, responseBytes.byteLength));
  Atomics.store(control, CONTROL_STATE, STATE_READY);
  Atomics.notify(control, CONTROL_STATE, 1);
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
    throw new Error(`Oracle native worker cannot safely translate SQLite identifier "${identifier}".`);
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

async function applyTransactionControl(controlStatement: 'begin' | 'commit' | 'rollback'): Promise<void> {
  if (controlStatement === 'begin') {
    inTransaction = true;
    return;
  }

  const oracle = await getConnection();
  if (controlStatement === 'commit') {
    await oracle.commit();
  } else {
    await oracle.rollback();
  }
  inTransaction = false;
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

async function executeInsertWithIdentityReturn(
  oracle: oracledb.Connection,
  sql: string,
  binds: Record<string, unknown>,
): Promise<RunResult | null> {
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
      `OracleNativeAdapter cannot translate INSERT OR REPLACE for ${insert.tableName}; no primary or unique key is fully present in the insert column list.`,
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
      `OracleNativeAdapter cannot translate INSERT OR REPLACE for ${insert.tableName}; every inserted column is part of the conflict key.`,
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

async function executeReplaceRun(insert: SqliteInsertValues, binds: Record<string, unknown>): Promise<RunResult> {
  const oracle = await getConnection();
  const keyColumns = await uniqueColumnsForReplace(oracle, insert);
  const sql = buildReplaceMergeSql(insert, keyColumns);
  const result = await oracle.execute(sql, binds, { autoCommit: !inTransaction });
  return {
    changes: Number(result.rowsAffected ?? 0),
    lastInsertRowid: 0,
  };
}

async function executeRun(request: Extract<WorkerRequest, { type: 'query' }>): Promise<RunResult> {
  const oracle = await getConnection();
  if (request.sqliteReplace) return executeReplaceRun(request.sqliteReplace, request.binds);

  try {
    const identityResult = await executeInsertWithIdentityReturn(oracle, request.sql, request.binds);
    if (identityResult) return identityResult;
  } catch (err) {
    if (request.sqliteConflictAction === 'ignore' && isUniqueConstraintError(err)) {
      return { changes: 0, lastInsertRowid: 0 };
    }
    throw withSqlContext(err, request.sql);
  }

  let result: oracledb.Result<unknown>;
  try {
    result = await oracle.execute(request.sql, request.binds, { autoCommit: !inTransaction });
  } catch (err) {
    if (request.sqliteConflictAction === 'ignore' && isUniqueConstraintError(err)) {
      return { changes: 0, lastInsertRowid: 0 };
    }
    throw withSqlContext(err, request.sql);
  }

  return {
    changes: Number(result.rowsAffected ?? 0),
    lastInsertRowid: 0,
  };
}

async function executeQuery(request: Extract<WorkerRequest, { type: 'query' }>): Promise<unknown> {
  if (request.mode === 'run') return executeRun(request);

  const oracle = await getConnection();
  const sql = await expandAliasStars(oracle, request.sql);
  let result: oracledb.Result<unknown>;
  try {
    result = await oracle.execute(sql, request.binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: request.mode === 'get' ? 1 : undefined,
    });
  } catch (err) {
    throw withSqlContext(err, sql);
  }
  const rows = normalizeRows(result.rows as unknown[] | undefined);
  return request.mode === 'get' ? rows[0] : rows;
}

async function executeSqlBatch(sql: string): Promise<void> {
  const statements = splitSqlStatements(sql);
  const oracle = await getConnection();

  for (const statement of statements) {
    const controlStatement = transactionControl(statement);
    if (controlStatement) {
      await applyTransactionControl(controlStatement);
      continue;
    }

    if (isIgnoredPragma(statement)) continue;
    await oracle.execute(statement, {}, { autoCommit: !inTransaction });
  }
}

async function closeConnection(): Promise<void> {
  if (!connection) return;
  try {
    if (inTransaction) await connection.rollback();
    await connection.close();
  } finally {
    connection = null;
    inTransaction = false;
  }
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  switch (request.type) {
    case 'connect':
      await getConnection();
      return { id: request.id, ok: true, result: null };
    case 'close':
      await closeConnection();
      return { id: request.id, ok: true, result: null };
    case 'exec':
      await executeSqlBatch(request.sql);
      return { id: request.id, ok: true, result: null };
    case 'query':
      return { id: request.id, ok: true, result: await executeQuery(request) };
  }
}

assertParentPort().on('message', (request: WorkerRequest) => {
  void (async () => {
    try {
      writeResponse(await handleRequest(request));
    } catch (err) {
      writeResponse({ id: request.id, ok: false, error: serializeError(err) });
    }
  })();
});
