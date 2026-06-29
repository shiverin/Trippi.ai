import { OracleAutonomousConfig, getOracleAutonomousConfigFromEnv } from './oracleAutonomous';

import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

export type OracleNativeRow = Record<string, unknown>;

export interface OracleNativeRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface OracleNativeAdapterOptions {
  config?: OracleAutonomousConfig;
  env?: NodeJS.ProcessEnv;
  workerPath?: string;
  responseBufferBytes?: number;
  syncTimeoutMs?: number;
  startupTimeoutMs?: number;
}

export interface TranslatedSql {
  sql: string;
  positionalBindNames: string[];
  namedBindNames: string[];
  noop?: 'pragma';
  sqliteConflictAction?: 'ignore';
  sqliteReplace?: SqliteInsertValues;
}

type BindRecord = Record<string, unknown>;

interface SqliteInsertValues {
  tableName: string;
  columns: string[];
  values: string[];
}

type WorkerRequest =
  | { type: 'connect' }
  | { type: 'close' }
  | { type: 'exec'; sql: string }
  | {
      type: 'query';
      mode: 'get' | 'all' | 'run';
      sql: string;
      binds: BindRecord;
      sqliteConflictAction?: 'ignore';
      sqliteReplace?: SqliteInsertValues;
    };

interface WorkerResponse<T = unknown> {
  id: number;
  ok: boolean;
  result?: T;
  error?: SerializedError;
}

interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
  errorNum?: number;
  offset?: number;
}

const CONTROL_STATE = 0;
const CONTROL_LENGTH = 1;
const STATE_WAITING = 0;
const STATE_READY = 1;
const DEFAULT_RESPONSE_BUFFER_BYTES = 16 * 1024 * 1024;
const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const RESERVED_COLUMN_IDENTIFIERS = new Set(['ACTION', 'DATE', 'RESOURCE']);

function isOracleAutonomousConfig(
  value: OracleNativeAdapterOptions | OracleAutonomousConfig,
): value is OracleAutonomousConfig {
  const candidate = value as OracleAutonomousConfig;
  return (
    typeof candidate.user === 'string' &&
    typeof candidate.password === 'string' &&
    typeof candidate.connectString === 'string'
  );
}

function defaultWorkerPath(): string {
  const compiledWorker = path.join(__dirname, 'oracleNativeWorker.js');
  if (fs.existsSync(compiledWorker)) return compiledWorker;
  return path.join(__dirname, 'oracleNativeWorker.ts');
}

function isIdentifierStart(char: string | undefined): boolean {
  return !!char && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$#]/.test(char);
}

function readIdentifier(sql: string, start: number): { name: string; end: number } {
  let end = start;
  while (end < sql.length && isIdentifierPart(sql[end])) end++;
  return { name: sql.slice(start, end), end };
}

function copyQuoted(sql: string, index: number, quote: string): { chunk: string; end: number } {
  let end = index + 1;
  while (end < sql.length) {
    if (sql[end] === quote) {
      if (sql[end + 1] === quote) {
        end += 2;
        continue;
      }
      end++;
      break;
    }
    end++;
  }
  return { chunk: sql.slice(index, end), end };
}

function copyUntil(sql: string, index: number, terminator: string): { chunk: string; end: number } {
  const end = sql.indexOf(terminator, index + terminator.length);
  if (end === -1) return { chunk: sql.slice(index), end: sql.length };
  return { chunk: sql.slice(index, end + terminator.length), end: end + terminator.length };
}

function skipWhitespace(sql: string, index: number): number {
  let i = index;
  while (i < sql.length && /\s/.test(sql[i])) i++;
  return i;
}

function isWordBoundary(sql: string, index: number): boolean {
  return !isIdentifierPart(sql[index]);
}

function skipSqlQuoted(sql: string, index: number): number {
  const quote = sql[index];
  if (quote === "'" || quote === '"') return copyQuoted(sql, index, quote).end;
  if (quote === '`') return copyUntil(sql, index, '`').end;
  if (quote === '[') return copyUntil(sql, index, ']').end;
  return index + 1;
}

function findTopLevelKeyword(sql: string, keyword: string, start = 0): number {
  const upperKeyword = keyword.toUpperCase();
  let depth = 0;
  let i = start;

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
      i = copyUntil(sql, i, '*/').end;
      continue;
    }
    if (char === '(') {
      depth++;
      i++;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (
      depth === 0 &&
      sql.slice(i, i + upperKeyword.length).toUpperCase() === upperKeyword &&
      (i === 0 || isWordBoundary(sql, i - 1)) &&
      isWordBoundary(sql, i + upperKeyword.length)
    ) {
      return i;
    }
    i++;
  }

  return -1;
}

function findTopLevelChar(sql: string, target: string): number {
  let depth = 0;
  let i = 0;

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
      i = copyUntil(sql, i, '*/').end;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && char === target) return i;
    i++;
  }

  return -1;
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
      i = copyUntil(sql, i, '*/').end;
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
      i = copyUntil(input, i, '*/').end;
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
    throw new Error(`OracleNativeAdapter cannot safely translate SQLite identifier "${identifier}".`);
  }
  return `"${normalized}"`;
}

function parseSimpleInsertValues(
  sql: string,
): (SqliteInsertValues & { prefixAction?: 'IGNORE' | 'REPLACE'; tail: string }) | null {
  const trimmed = sql.trim().replace(/;$/, '').trim();
  const match = /^INSERT\s+(?:OR\s+(IGNORE|REPLACE)\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_$#]*)\s*/i.exec(trimmed);
  if (!match) return null;

  let index = match[0].length;
  index = skipWhitespace(trimmed, index);
  const columnsGroup = readBalancedGroup(trimmed, index);
  if (!columnsGroup) return null;
  const columns = splitTopLevel(columnsGroup.content).map(normalizeIdentifier);
  index = skipWhitespace(trimmed, columnsGroup.end);

  if (trimmed.slice(index, index + 6).toUpperCase() !== 'VALUES' || !isWordBoundary(trimmed, index + 6)) return null;
  index = skipWhitespace(trimmed, index + 6);
  const valuesGroup = readBalancedGroup(trimmed, index);
  if (!valuesGroup) return null;

  const values = splitTopLevel(valuesGroup.content);
  if (columns.length === 0 || columns.length !== values.length) return null;

  return {
    prefixAction: match[1]?.toUpperCase() as 'IGNORE' | 'REPLACE' | undefined,
    tableName: match[2],
    columns,
    values,
    tail: trimmed.slice(valuesGroup.end).trim(),
  };
}

function replaceExcludedReferences(expression: string, columns: string[]): string {
  let translated = expression;
  for (const column of columns) {
    const quoted = quoteOracleIdentifier(column);
    translated = translated.replace(
      new RegExp(`\\bexcluded\\s*\\.\\s*${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
      `src.${quoted}`,
    );
  }
  return translated;
}

function buildMergeSql(insert: SqliteInsertValues, conflictColumns: string[], assignments: string[]): string {
  const columnSet = new Set(insert.columns.map((column) => column.toLowerCase()));
  for (const column of conflictColumns) {
    if (!columnSet.has(column.toLowerCase())) {
      throw new Error(`OracleNativeAdapter cannot translate ON CONFLICT for omitted column "${column}".`);
    }
  }

  const selectList = insert.values
    .map((value, index) => `${value} AS ${quoteOracleIdentifier(insert.columns[index])}`)
    .join(', ');
  const onClause = conflictColumns
    .map((column) => `dst.${quoteOracleIdentifier(column)} = src.${quoteOracleIdentifier(column)}`)
    .join(' AND ');
  const updateClause = assignments
    .map((assignment) => {
      const equalIndex = findTopLevelChar(assignment, '=');
      if (equalIndex === -1) {
        throw new Error(`OracleNativeAdapter cannot translate ON CONFLICT assignment "${assignment}".`);
      }
      const left = normalizeIdentifier(assignment.slice(0, equalIndex).trim());
      const right = replaceExcludedReferences(assignment.slice(equalIndex + 1).trim(), insert.columns);
      return `dst.${quoteOracleIdentifier(left)} = ${right}`;
    })
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

function translateOnConflict(sql: string): string | null {
  const insert = parseSimpleInsertValues(sql);
  if (!insert || !insert.tail) return null;

  const conflictMatch = /^ON\s+CONFLICT\s*\(/i.exec(insert.tail);
  if (!conflictMatch) return null;

  const openIndex = insert.tail.indexOf('(', conflictMatch.index);
  const conflictGroup = readBalancedGroup(insert.tail, openIndex);
  if (!conflictGroup) return null;

  const afterConflict = insert.tail.slice(conflictGroup.end).trim();
  const updateMatch = /^DO\s+UPDATE\s+SET\s+/i.exec(afterConflict);
  if (!updateMatch) return null;

  const assignmentsText = afterConflict.slice(updateMatch[0].length).replace(/;$/, '').trim();
  if (!assignmentsText || /\sWHERE\s/i.test(assignmentsText)) return null;

  return buildMergeSql(
    insert,
    splitTopLevel(conflictGroup.content).map(normalizeIdentifier),
    splitTopLevel(assignmentsText),
  );
}

function translateLimitOffset(sql: string): string {
  const trimmedStart = sql.trimStart();
  if (!/^(SELECT|WITH)\b/i.test(trimmedStart)) return sql;

  const limitIndex = findTopLevelKeyword(sql, 'LIMIT');
  if (limitIndex === -1) return sql;

  const beforeLimit = sql.slice(0, limitIndex).trimEnd();
  const afterLimit = sql
    .slice(limitIndex + 'LIMIT'.length)
    .trim()
    .replace(/;$/, '')
    .trim();
  if (!afterLimit) return sql;

  let limitExpr = afterLimit;
  let offsetExpr: string | null = null;
  const commaIndex = findTopLevelChar(afterLimit, ',');
  if (commaIndex !== -1) {
    offsetExpr = afterLimit.slice(0, commaIndex).trim();
    limitExpr = afterLimit.slice(commaIndex + 1).trim();
  } else {
    const offsetIndex = findTopLevelKeyword(afterLimit, 'OFFSET');
    if (offsetIndex !== -1) {
      limitExpr = afterLimit.slice(0, offsetIndex).trim();
      offsetExpr = afterLimit.slice(offsetIndex + 'OFFSET'.length).trim();
    }
  }

  const clauses: string[] = [beforeLimit];
  if (offsetExpr) clauses.push(`OFFSET ${offsetExpr} ROWS`);
  if (limitExpr !== '-1') clauses.push(`FETCH NEXT ${limitExpr} ROWS ONLY`);
  return clauses.join(' ');
}

function translateDateTimeFunctions(sql: string): string {
  let translated = '';
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const end = skipSqlQuoted(sql, i);
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
      const end = copyUntil(sql, i, '*/').end;
      translated += sql.slice(i, end);
      i = end;
      continue;
    }

    const rest = sql.slice(i);
    const datetimeNow = /^\bdatetime\s*\(\s*'now'\s*\)/i.exec(rest);
    if (datetimeNow) {
      translated += 'CURRENT_TIMESTAMP';
      i += datetimeNow[0].length;
      continue;
    }

    const dateOffset = /^\bdate\s*\(\s*'now'\s*,\s*'([+-])'\s*\|\|\s*([^|]+?)\s*\|\|\s*'\s*days'\s*\)/i.exec(rest);
    if (dateOffset) {
      translated += `TO_CHAR(TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)) ${dateOffset[1]} ${dateOffset[2].trim()}, 'YYYY-MM-DD')`;
      i += dateOffset[0].length;
      continue;
    }

    const dateNow = /^\bdate\s*\(\s*'now'\s*\)/i.exec(rest);
    if (dateNow) {
      translated += "TO_CHAR(SYS_EXTRACT_UTC(SYSTIMESTAMP), 'YYYY-MM-DD')";
      i += dateNow[0].length;
      continue;
    }

    translated += char;
    i++;
  }

  return translated;
}

function quoteReservedColumnIdentifiers(sql: string): string {
  let translated = '';
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const end = skipSqlQuoted(sql, i);
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
      const end = copyUntil(sql, i, '*/').end;
      translated += sql.slice(i, end);
      i = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const identifier = readIdentifier(sql, i);
      const upper = identifier.name.toUpperCase();
      const afterIdentifier = skipWhitespace(sql, identifier.end);
      if (RESERVED_COLUMN_IDENTIFIERS.has(upper) && sql[afterIdentifier] !== '(') {
        translated += `"${upper}"`;
      } else {
        translated += identifier.name;
      }
      i = identifier.end;
      continue;
    }

    translated += char;
    i++;
  }

  return translated;
}

function translateNumericCaseFlags(sql: string): string {
  return sql.replace(/\bCASE\s+WHEN\s+(:[A-Za-z_][A-Za-z0-9_$#]*)\s+THEN\b/gi, 'CASE WHEN $1 <> 0 THEN');
}

function translateSqliteSyntax(
  sql: string,
): Pick<TranslatedSql, 'sql' | 'noop' | 'sqliteConflictAction' | 'sqliteReplace'> {
  const trimmed = sql.trim();
  if (/^PRAGMA\b/i.test(trimmed)) return { sql, noop: 'pragma' };

  const onConflictSql = translateOnConflict(sql);
  if (onConflictSql) {
    return {
      sql: translateNumericCaseFlags(
        quoteReservedColumnIdentifiers(translateDateTimeFunctions(translateLimitOffset(onConflictSql))),
      ),
    };
  }

  const insert = parseSimpleInsertValues(sql);
  let translated = sql;
  let sqliteConflictAction: 'ignore' | undefined;
  let sqliteReplace: SqliteInsertValues | undefined;

  if (insert?.prefixAction === 'IGNORE') {
    translated = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\b/i, 'INSERT');
    sqliteConflictAction = 'ignore';
  } else if (insert?.prefixAction === 'REPLACE') {
    translated = sql.replace(/^\s*INSERT\s+OR\s+REPLACE\b/i, 'INSERT');
    sqliteReplace = { tableName: insert.tableName, columns: insert.columns, values: insert.values };
  }

  translated = translateNumericCaseFlags(
    quoteReservedColumnIdentifiers(translateDateTimeFunctions(translateLimitOffset(translated))),
  );
  return { sql: translated, sqliteConflictAction, sqliteReplace };
}

export function translateSqlPlaceholders(sql: string): TranslatedSql {
  const positionalBindNames: string[] = [];
  const namedBindNames = new Set<string>();
  let translated = '';
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" || char === '"') {
      const quoted = copyQuoted(sql, i, char);
      translated += quoted.chunk;
      i = quoted.end;
      continue;
    }

    if (char === '`') {
      const quoted = copyUntil(sql, i, '`');
      translated += quoted.chunk;
      i = quoted.end;
      continue;
    }

    if (char === '[') {
      const quoted = copyUntil(sql, i, ']');
      translated += quoted.chunk;
      i = quoted.end;
      continue;
    }

    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i + 2);
      if (newline === -1) {
        translated += sql.slice(i);
        break;
      }
      translated += sql.slice(i, newline + 1);
      i = newline + 1;
      continue;
    }

    if (char === '/' && next === '*') {
      const comment = copyUntil(sql, i, '*/');
      translated += comment.chunk;
      i = comment.end;
      continue;
    }

    if (char === '?') {
      if (/[0-9]/.test(next ?? '')) {
        throw new Error('OracleNativeAdapter does not support SQLite numbered placeholders (?NNN) yet.');
      }
      const bindName = `b${positionalBindNames.length + 1}`;
      positionalBindNames.push(bindName);
      translated += `:${bindName}`;
      i++;
      continue;
    }

    if ((char === ':' || char === '@' || char === '$') && isIdentifierStart(next)) {
      const identifier = readIdentifier(sql, i + 1);
      namedBindNames.add(identifier.name);
      translated += `:${identifier.name}`;
      i = identifier.end;
      continue;
    }

    translated += char;
    i++;
  }

  const sqliteSyntax = translateSqliteSyntax(translated);
  return { ...sqliteSyntax, positionalBindNames, namedBindNames: [...namedBindNames] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeBindValue(value: unknown): unknown {
  if (typeof value === 'undefined') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}

function lookupNamedBinding(source: Record<string, unknown>, name: string): unknown {
  for (const key of [name, `:${name}`, `@${name}`, `$${name}`]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  throw new Error(`Missing OracleNativeAdapter named binding: ${name}`);
}

function buildOracleBinds(args: unknown[], translated: TranslatedSql): BindRecord {
  const onlyArg = args.length === 1 ? args[0] : undefined;
  const bindSource = Array.isArray(onlyArg) ? onlyArg : isPlainObject(onlyArg) ? onlyArg : args;
  const binds: BindRecord = {};

  if (isPlainObject(bindSource)) {
    for (const name of translated.positionalBindNames) {
      binds[name] = normalizeBindValue(lookupNamedBinding(bindSource, name));
    }
    for (const name of translated.namedBindNames) {
      binds[name] = normalizeBindValue(lookupNamedBinding(bindSource, name));
    }
    return binds;
  }

  if (translated.namedBindNames.length > 0) {
    throw new Error('OracleNativeAdapter named placeholders require an object binding.');
  }

  translated.positionalBindNames.forEach((name, index) => {
    binds[name] = normalizeBindValue(bindSource[index]);
  });

  return binds;
}

function reviveResponseValue(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    (value as { __oracleNativeAdapterType?: string }).__oracleNativeAdapterType === 'buffer' &&
    typeof (value as { base64?: string }).base64 === 'string'
  ) {
    return Buffer.from((value as { base64: string }).base64, 'base64');
  }
  return value;
}

function responseError(error: SerializedError | undefined): Error {
  const err = new Error(error?.message ?? 'Oracle native worker failed');
  err.name = error?.name ?? 'OracleNativeWorkerError';
  if (error?.stack) err.stack = `${err.name}: ${err.message}\nCaused by: ${error.stack}`;
  const writable = err as Error & { code?: string | number; errorNum?: number; offset?: number };
  if (error?.code !== undefined) writable.code = error.code;
  if (error?.errorNum !== undefined) writable.errorNum = error.errorNum;
  if (error?.offset !== undefined) writable.offset = error.offset;
  return err;
}

export class OracleNativeStatement {
  constructor(
    private readonly adapter: OracleNativeAdapter,
    readonly source: string,
    private readonly translated: TranslatedSql,
  ) {}

  get(...args: unknown[]): OracleNativeRow | undefined {
    if (this.translated.noop) return undefined;
    return this.adapter.query<OracleNativeRow | undefined>('get', this.translated, args);
  }

  all(...args: unknown[]): OracleNativeRow[] {
    if (this.translated.noop) return [];
    return this.adapter.query<OracleNativeRow[]>('all', this.translated, args);
  }

  run(...args: unknown[]): OracleNativeRunResult {
    if (this.translated.noop) return { changes: 0, lastInsertRowid: 0 };
    return this.adapter.query<OracleNativeRunResult>('run', this.translated, args);
  }
}

export class OracleNativeAdapter {
  private readonly worker: Worker;
  private readonly control: Int32Array;
  private readonly responseBytes: Uint8Array;
  private readonly syncTimeoutMs: number;
  private nextRequestId = 0;
  private closed = false;

  constructor(optionsOrConfig: OracleNativeAdapterOptions | OracleAutonomousConfig = {}) {
    const options: OracleNativeAdapterOptions = isOracleAutonomousConfig(optionsOrConfig)
      ? { config: optionsOrConfig }
      : optionsOrConfig;
    const config = options.config ?? getOracleAutonomousConfigFromEnv(options.env ?? process.env);
    if (!config) {
      throw new Error(
        'Missing Oracle configuration for OracleNativeAdapter. Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
      );
    }

    const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const responseBuffer = new SharedArrayBuffer(options.responseBufferBytes ?? DEFAULT_RESPONSE_BUFFER_BYTES);
    this.control = new Int32Array(controlBuffer);
    this.responseBytes = new Uint8Array(responseBuffer);
    this.syncTimeoutMs = options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;

    this.worker = new Worker(options.workerPath ?? defaultWorkerPath(), {
      workerData: { config, controlBuffer, responseBuffer },
    });

    this.request({ type: 'connect' }, options.startupTimeoutMs ?? this.syncTimeoutMs);
  }

  prepare(sql: string): OracleNativeStatement {
    if (this.closed) throw new Error('OracleNativeAdapter is closed.');
    return new OracleNativeStatement(this, sql, translateSqlPlaceholders(sql));
  }

  exec(sql: string): this {
    this.request({ type: 'exec', sql });
    return this;
  }

  pragma(_source: string): unknown[] {
    return [];
  }

  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
  ): ((...args: Args) => Result) & {
    default: (...args: Args) => Result;
    deferred: (...args: Args) => Result;
    immediate: (...args: Args) => Result;
    exclusive: (...args: Args) => Result;
  } {
    const run = (...args: Args): Result => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          this.exec('ROLLBACK');
        } catch {
          /* preserve original error */
        }
        throw err;
      }
    };

    return Object.assign(run, {
      default: run,
      deferred: run,
      immediate: run,
      exclusive: run,
    });
  }

  close(): void {
    if (this.closed) return;
    try {
      this.request({ type: 'close' });
    } finally {
      this.closed = true;
      void this.worker.terminate();
    }
  }

  query<T>(mode: 'get' | 'all' | 'run', translated: TranslatedSql, args: unknown[]): T {
    const binds = buildOracleBinds(args, translated);
    return this.request<T>({
      type: 'query',
      mode,
      sql: translated.sql,
      binds,
      sqliteConflictAction: translated.sqliteConflictAction,
      sqliteReplace: translated.sqliteReplace,
    });
  }

  private request<T = unknown>(payload: WorkerRequest, timeoutMs = this.syncTimeoutMs): T {
    if (this.closed && payload.type !== 'close') throw new Error('OracleNativeAdapter is closed.');

    const id = ++this.nextRequestId;
    Atomics.store(this.control, CONTROL_LENGTH, 0);
    Atomics.store(this.control, CONTROL_STATE, STATE_WAITING);

    try {
      this.worker.postMessage({ ...payload, id });
      const response = this.waitForResponse<T>(id, timeoutMs);
      if (!response.ok) throw responseError(response.error);
      return response.result as T;
    } catch (err) {
      if (err instanceof Error && /timed out/.test(err.message)) {
        this.closed = true;
        void this.worker.terminate();
      }
      throw err;
    }
  }

  private waitForResponse<T>(id: number, timeoutMs: number): WorkerResponse<T> {
    const startedAt = Date.now();

    while (Atomics.load(this.control, CONTROL_STATE) === STATE_WAITING) {
      const elapsed = Date.now() - startedAt;
      const remaining = timeoutMs > 0 ? Math.max(timeoutMs - elapsed, 0) : undefined;
      if (timeoutMs > 0 && remaining === 0) {
        throw new Error(`Oracle native worker request ${id} timed out after ${timeoutMs} ms.`);
      }

      const waitResult = Atomics.wait(this.control, CONTROL_STATE, STATE_WAITING, remaining);
      if (waitResult === 'timed-out') {
        throw new Error(`Oracle native worker request ${id} timed out after ${timeoutMs} ms.`);
      }
    }

    const length = Atomics.load(this.control, CONTROL_LENGTH);
    if (length <= 0 || length > this.responseBytes.byteLength) {
      throw new Error(`Oracle native worker returned an invalid response length for request ${id}.`);
    }

    const json = Buffer.from(this.responseBytes.subarray(0, length)).toString('utf8');
    const response = JSON.parse(json, reviveResponseValue) as WorkerResponse<T>;
    if (response.id !== id) {
      throw new Error(`Oracle native worker response mismatch: expected ${id}, received ${response.id}.`);
    }
    return response;
  }
}

export default OracleNativeAdapter;
