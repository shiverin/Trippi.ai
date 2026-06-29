import { getOracleAutonomousConfigFromEnv, openOracleAutonomousConnection } from './oracleAutonomous';

import Database from 'better-sqlite3';
import crypto from 'crypto';
import oracledb from 'oracledb';
import path from 'path';

type NativeColumnKind = 'blob' | 'clob' | 'double' | 'number' | 'string' | 'timestamp';

interface SqliteTableRow {
  name: string;
  sql: string | null;
}

interface SqliteColumnRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SqliteForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  on_update: string;
  on_delete: string;
  match: string;
}

interface SqliteIndexRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface SqliteIndexColumnRow {
  seqno: number;
  cid: number;
  name: string | null;
  desc: number;
  coll: string | null;
  key: number;
}

interface NativeColumn {
  name: string;
  sqliteType: string;
  kind: NativeColumnKind;
  oracleType: string;
  notNull: boolean;
  defaultValue: string | null;
  pkOrder: number;
  identity: boolean;
  identityStartWith?: number;
  maxStringSize?: number;
}

interface NativeIndexColumn {
  name: string;
  descending: boolean;
}

interface NativeIndex {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: NativeIndexColumn[];
  skippedReason?: string;
}

interface NativeForeignKey {
  id: number;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
}

interface NativeTable {
  name: string;
  sql: string | null;
  columns: NativeColumn[];
  primaryKey: string[];
  indexes: NativeIndex[];
  foreignKeys: NativeForeignKey[];
  rowCount: number;
}

export interface OracleNativePlan {
  source: string;
  tables: NativeTable[];
  ddl: {
    createTables: string[];
    indexes: string[];
    foreignKeys: string[];
    drops: string[];
  };
  warnings: string[];
}

export interface OracleNativeSchemaOptions {
  dropExisting?: boolean;
  includeForeignKeys?: boolean;
}

export interface OracleNativeImportOptions extends OracleNativeSchemaOptions {
  batchSize?: number;
  clearExisting?: boolean;
}

export interface OracleNativeSchemaResult {
  ok: true;
  source: string;
  tableCount: number;
  createdTables: string[];
  skippedExistingTables: string[];
  droppedTables: string[];
  createdIndexes: string[];
  skippedExistingIndexes: string[];
  createdForeignKeys: string[];
  skippedExistingForeignKeys: string[];
  warnings: string[];
}

export interface OracleNativeImportResult extends OracleNativeSchemaResult {
  rowCount: number;
  tableRows: Array<{ table: string; rows: number }>;
}

const DEFAULT_BATCH_SIZE = 250;
const MAX_ORACLE_VARCHAR_SIZE = 4000;
const LONG_TEXT_NAME_RE =
  /(^|_)(caption|config|content|description|details|metadata|notes?|options|params|payload|response_body|story|text|uris?|value)(_|$)|json/i;

export function resolveNativeSqliteDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TRIPPI_DB_FILE) return env.TRIPPI_DB_FILE;
  return path.resolve(__dirname, '../../data/travel.db');
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toOracleIdentifier(identifier: string): string {
  const oracleIdentifier = identifier.toUpperCase();
  if (!/^[A-Z][A-Z0-9_$#]*$/.test(oracleIdentifier)) {
    throw new Error(`SQLite identifier "${identifier}" cannot be mapped to a simple Oracle identifier.`);
  }
  if (oracleIdentifier.length > 128) {
    throw new Error(`Oracle identifier "${oracleIdentifier}" is longer than 128 characters.`);
  }
  return oracleIdentifier;
}

function quoteOracleIdentifier(identifier: string): string {
  return `"${toOracleIdentifier(identifier)}"`;
}

function shortOracleName(prefix: string, parts: string[]): string {
  const raw = [prefix, ...parts]
    .map((part) => {
      const normalized = part.toUpperCase().replace(/[^A-Z0-9_$#]/g, '_');
      return /^[A-Z]/.test(normalized) ? normalized : `N_${normalized}`;
    })
    .join('_');
  if (raw.length <= 128) return raw;

  const digest = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12).toUpperCase();
  return `${raw.slice(0, 115)}_${digest}`;
}

function normalizeSqliteType(type: string): string {
  return type.trim().toUpperCase();
}

function sqliteTypeAffinity(type: string): NativeColumnKind {
  const normalized = normalizeSqliteType(type);
  if (normalized.includes('BLOB')) return 'blob';
  if (normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB')) return 'double';
  if (normalized.includes('INT') || normalized.includes('BIGINT') || normalized.includes('BOOLEAN')) return 'number';
  if (normalized.includes('DATE') || normalized.includes('TIME')) return 'timestamp';
  if (normalized.includes('NUM') || normalized.includes('DEC')) return 'number';
  return 'string';
}

function isTextualKind(kind: NativeColumnKind): boolean {
  return kind === 'string' || kind === 'clob';
}

function isSingleIntegerPrimaryKey(table: NativeTable, column: SqliteColumnRow): boolean {
  const primaryKeyColumns = table.columns.filter((candidate) => candidate.pkOrder > 0);
  return (
    column.name.toLowerCase() === 'id' &&
    primaryKeyColumns.length === 1 &&
    column.pk === 1 &&
    sqliteTypeAffinity(column.type) === 'number'
  );
}

function maxIntegerColumnValue(db: Database.Database, tableName: string, columnName: string): number {
  const row = db
    .prepare(`SELECT MAX(${quoteSqliteIdentifier(columnName)}) AS max_value FROM ${quoteSqliteIdentifier(tableName)}`)
    .get() as { max_value?: number | null };
  const value = Number(row.max_value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function maxTextBytes(db: Database.Database, tableName: string, columnName: string): number {
  const row = db
    .prepare(
      `
        SELECT MAX(LENGTH(CAST(${quoteSqliteIdentifier(columnName)} AS BLOB))) AS max_bytes
        FROM ${quoteSqliteIdentifier(tableName)}
        WHERE ${quoteSqliteIdentifier(columnName)} IS NOT NULL
      `,
    )
    .get() as { max_bytes?: number | null };
  const value = Number(row.max_bytes ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function collectIndexedColumnNames(db: Database.Database, tableName: string): Set<string> {
  const indexed = new Set<string>();
  const indexes = db.prepare(`PRAGMA index_list(${quoteSqliteIdentifier(tableName)})`).all() as SqliteIndexRow[];
  for (const index of indexes) {
    const columns = db
      .prepare(`PRAGMA index_xinfo(${quoteSqliteIdentifier(index.name)})`)
      .all() as SqliteIndexColumnRow[];
    for (const column of columns) {
      if (column.key && column.name) indexed.add(column.name);
    }
  }
  return indexed;
}

function shouldUseClob(
  db: Database.Database,
  tableName: string,
  column: SqliteColumnRow,
  kind: NativeColumnKind,
  indexedColumnNames: Set<string>,
): boolean {
  if (kind !== 'string') return false;
  if (column.pk > 0 || indexedColumnNames.has(column.name) || column.dflt_value !== null) return false;

  const currentMaxBytes = maxTextBytes(db, tableName, column.name);
  return currentMaxBytes > MAX_ORACLE_VARCHAR_SIZE || LONG_TEXT_NAME_RE.test(column.name);
}

function oracleTypeForColumn(kind: NativeColumnKind): string {
  switch (kind) {
    case 'blob':
      return 'BLOB';
    case 'clob':
      return 'CLOB';
    case 'double':
      return 'BINARY_DOUBLE';
    case 'number':
      return 'NUMBER(19,0)';
    case 'timestamp':
      return 'TIMESTAMP(6)';
    case 'string':
      return `VARCHAR2(${MAX_ORACLE_VARCHAR_SIZE} CHAR)`;
  }
}

function translateDefault(
  column: SqliteColumnRow,
  kind: NativeColumnKind,
  warnings: string[],
  tableName: string,
): string | null {
  const value = column.dflt_value?.trim();
  if (!value || value.toUpperCase() === 'NULL') return null;
  if (kind === 'blob' || kind === 'clob') {
    warnings.push(`Skipped unsupported LOB default on ${tableName}.${column.name}.`);
    return null;
  }

  const normalized = value.replace(/\s+/g, '').toLowerCase();
  if (normalized === 'current_timestamp' || normalized === '(current_timestamp)') {
    return kind === 'timestamp' ? 'SYSTIMESTAMP' : 'CURRENT_TIMESTAMP';
  }
  if (normalized === "strftime('%s','now')" || normalized === "(strftime('%s','now'))") {
    return "FLOOR((CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE) - DATE '1970-01-01') * 86400)";
  }
  if (kind === 'number' || kind === 'double') {
    if (/^\(?[-+]?\d+(?:\.\d+)?\)?$/.test(value)) return value.replace(/^\((.*)\)$/, '$1');
    warnings.push(`Skipped unsupported numeric default "${value}" on ${tableName}.${column.name}.`);
    return null;
  }
  if (kind === 'timestamp') {
    warnings.push(`Skipped unsupported timestamp default "${value}" on ${tableName}.${column.name}.`);
    return null;
  }
  if (/^'.*'$/.test(value)) return value;

  warnings.push(`Skipped unsupported string default "${value}" on ${tableName}.${column.name}.`);
  return null;
}

function introspectColumns(
  db: Database.Database,
  tableName: string,
  indexedColumnNames: Set<string>,
  warnings: string[],
): NativeColumn[] {
  const rawColumns = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as SqliteColumnRow[];
  const placeholderTable: NativeTable = {
    name: tableName,
    sql: null,
    columns: rawColumns.map((column) => ({
      name: column.name,
      sqliteType: column.type,
      kind: sqliteTypeAffinity(column.type),
      oracleType: '',
      notNull: Boolean(column.notnull),
      defaultValue: column.dflt_value,
      pkOrder: column.pk,
      identity: false,
    })),
    primaryKey: [],
    indexes: [],
    foreignKeys: [],
    rowCount: 0,
  };

  return rawColumns.map((column) => {
    const baseKind = sqliteTypeAffinity(column.type);
    const kind = shouldUseClob(db, tableName, column, baseKind, indexedColumnNames) ? 'clob' : baseKind;
    const identity = isSingleIntegerPrimaryKey(placeholderTable, column);
    const identityStartWith = identity
      ? Math.max(1, Math.floor(maxIntegerColumnValue(db, tableName, column.name)) + 1)
      : undefined;

    return {
      name: column.name,
      sqliteType: column.type,
      kind,
      oracleType: oracleTypeForColumn(kind),
      notNull: Boolean(column.notnull || column.pk),
      defaultValue: identity ? null : translateDefault(column, kind, warnings, tableName),
      pkOrder: column.pk,
      identity,
      identityStartWith,
      maxStringSize: isTextualKind(kind)
        ? Math.min(MAX_ORACLE_VARCHAR_SIZE, Math.max(1, maxTextBytes(db, tableName, column.name)))
        : undefined,
    };
  });
}

function introspectIndexes(db: Database.Database, tableName: string): NativeIndex[] {
  const indexes = db.prepare(`PRAGMA index_list(${quoteSqliteIdentifier(tableName)})`).all() as SqliteIndexRow[];
  return indexes.map((index) => {
    const columns = db
      .prepare(`PRAGMA index_xinfo(${quoteSqliteIdentifier(index.name)})`)
      .all() as SqliteIndexColumnRow[];
    const keyColumns = columns.filter((column) => Boolean(column.key)).sort((a, b) => a.seqno - b.seqno);
    const unsupported = keyColumns.find((column) => !column.name || column.cid < 0);

    return {
      name: index.name,
      unique: Boolean(index.unique),
      origin: index.origin,
      partial: Boolean(index.partial),
      columns: keyColumns
        .filter((column): column is SqliteIndexColumnRow & { name: string } => Boolean(column.name) && column.cid >= 0)
        .map((column) => ({ name: column.name, descending: Boolean(column.desc) })),
      skippedReason: unsupported ? 'Expression indexes are not translated to Oracle.' : undefined,
    };
  });
}

function introspectForeignKeys(
  db: Database.Database,
  tableName: string,
  primaryKeysByTable: Map<string, string[]>,
): NativeForeignKey[] {
  const foreignKeys = db
    .prepare(`PRAGMA foreign_key_list(${quoteSqliteIdentifier(tableName)})`)
    .all() as SqliteForeignKeyRow[];
  const grouped = new Map<number, SqliteForeignKeyRow[]>();
  for (const foreignKey of foreignKeys) {
    const group = grouped.get(foreignKey.id) ?? [];
    group.push(foreignKey);
    grouped.set(foreignKey.id, group);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, group]) => {
      const sorted = group.sort((a, b) => a.seq - b.seq);
      const referencedTable = sorted[0].table;
      const fallbackPrimaryKey = primaryKeysByTable.get(referencedTable) ?? ['id'];
      return {
        id,
        columns: sorted.map((foreignKey) => foreignKey.from),
        referencedTable,
        referencedColumns: sorted.map((foreignKey, index) => foreignKey.to ?? fallbackPrimaryKey[index] ?? 'id'),
        onDelete: sorted[0].on_delete,
      };
    });
}

function tableRowCount(db: Database.Database, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS row_count FROM ${quoteSqliteIdentifier(tableName)}`).get() as {
    row_count?: number;
  };
  return Number(row.row_count ?? 0);
}

function indexColumnKey(index: NativeIndex): string {
  return index.columns
    .map((column) => `${toOracleIdentifier(column.name)}:${column.descending ? 'DESC' : 'ASC'}`)
    .join(',');
}

function filterRedundantIndexes(table: NativeTable): NativeIndex[] {
  const seenUniqueKeys = new Set<string>();
  if (table.primaryKey.length > 0) {
    seenUniqueKeys.add(table.primaryKey.map((column) => `${toOracleIdentifier(column)}:ASC`).join(','));
  }

  return table.indexes.map((index) => {
    if (index.origin === 'pk')
      return { ...index, skippedReason: 'Primary key indexes are represented by Oracle primary key constraints.' };
    if (index.skippedReason) return index;
    const key = indexColumnKey(index);
    if (seenUniqueKeys.has(key)) {
      return {
        ...index,
        skippedReason: index.unique
          ? 'Another primary or unique key covers the same columns.'
          : 'A primary or unique key covers the same columns.',
      };
    }
    if (index.unique) {
      seenUniqueKeys.add(key);
    }
    if (index.columns.length === 0) return { ...index, skippedReason: 'Index has no translatable key columns.' };
    return index;
  });
}

export function readSqliteNativeSchema(sqlitePath = resolveNativeSqliteDbPath()): OracleNativePlan {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const warnings: string[] = [];
  try {
    const tableRows = db
      .prepare(
        `
          SELECT name, sql
          FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
      )
      .all() as SqliteTableRow[];
    const primaryKeysByTable = new Map<string, string[]>();

    for (const table of tableRows) {
      const columns = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table.name)})`).all() as SqliteColumnRow[];
      primaryKeysByTable.set(
        table.name,
        columns
          .filter((column) => column.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((column) => column.name),
      );
    }

    const tables = tableRows.map((table) => {
      const indexedColumnNames = collectIndexedColumnNames(db, table.name);
      const columns = introspectColumns(db, table.name, indexedColumnNames, warnings);
      const nativeTable: NativeTable = {
        name: table.name,
        sql: table.sql,
        columns,
        primaryKey: columns
          .filter((column) => column.pkOrder > 0)
          .sort((a, b) => a.pkOrder - b.pkOrder)
          .map((column) => column.name),
        indexes: [],
        foreignKeys: introspectForeignKeys(db, table.name, primaryKeysByTable),
        rowCount: tableRowCount(db, table.name),
      };
      nativeTable.indexes = filterRedundantIndexes({ ...nativeTable, indexes: introspectIndexes(db, table.name) });
      return nativeTable;
    });

    return buildOracleNativePlan(sqlitePath, tables, warnings);
  } finally {
    db.close();
  }
}

function buildColumnDefinition(column: NativeColumn): string {
  const parts = [quoteOracleIdentifier(column.name), column.oracleType];
  if (column.identity) {
    parts.push(`GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH ${column.identityStartWith ?? 1})`);
  }
  if (column.defaultValue) parts.push(`DEFAULT ${column.defaultValue}`);
  if (column.notNull && column.pkOrder === 0) parts.push('NOT NULL');
  return parts.join(' ');
}

function buildCreateTableSql(table: NativeTable): string {
  const definitions = table.columns.map((column) => `  ${buildColumnDefinition(column)}`);
  if (table.primaryKey.length > 0) {
    definitions.push(
      `  CONSTRAINT ${quoteOracleIdentifier(shortOracleName('PK', [table.name]))} PRIMARY KEY (${table.primaryKey
        .map(quoteOracleIdentifier)
        .join(', ')})`,
    );
  }

  return [`CREATE TABLE ${quoteOracleIdentifier(table.name)} (`, definitions.join(',\n'), `)`].join('\n');
}

function buildIndexSql(table: NativeTable, index: NativeIndex): string | null {
  if (index.skippedReason) return null;
  const rawName = index.name.startsWith('sqlite_autoindex')
    ? shortOracleName('UQ', [table.name, ...index.columns.map((column) => column.name)])
    : index.name;
  if (shouldUseUniqueConstraint(table, index)) {
    const columns = index.columns.map((column) => quoteOracleIdentifier(column.name)).join(', ');
    return `ALTER TABLE ${quoteOracleIdentifier(table.name)} ADD CONSTRAINT ${quoteOracleIdentifier(
      rawName,
    )} UNIQUE (${columns})`;
  }
  const columns = buildIndexColumnSql(table, index);
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteOracleIdentifier(rawName)} ON ${quoteOracleIdentifier(
    table.name,
  )} (${columns})`;
}

function shouldUseUniqueConstraint(table: NativeTable, index: NativeIndex): boolean {
  return (
    index.unique &&
    index.columns.length > 0 &&
    index.columns.every((column) => !column.descending && !isNullableIndexColumn(table, column.name))
  );
}

function buildIndexColumnSql(table: NativeTable, index: NativeIndex): string {
  if (!index.unique || !index.columns.some((column) => isNullableIndexColumn(table, column.name))) {
    return index.columns
      .map((column) => `${quoteOracleIdentifier(column.name)}${column.descending ? ' DESC' : ''}`)
      .join(', ');
  }

  const allIndexedColumnsPresent = index.columns
    .map((column) => `${quoteOracleIdentifier(column.name)} IS NOT NULL`)
    .join(' AND ');

  return index.columns
    .map((column) => {
      const expression = `CASE WHEN ${allIndexedColumnsPresent} THEN ${quoteOracleIdentifier(column.name)} END`;
      return `${expression}${column.descending ? ' DESC' : ''}`;
    })
    .join(', ');
}

function isNullableIndexColumn(table: NativeTable, columnName: string): boolean {
  const column = table.columns.find((candidate) => candidate.name === columnName);
  return column ? !column.notNull : true;
}

function buildForeignKeySql(table: NativeTable, foreignKey: NativeForeignKey): string {
  const constraintName = shortOracleName('FK', [table.name, String(foreignKey.id), foreignKey.referencedTable]);
  const columns = foreignKey.columns.map(quoteOracleIdentifier).join(', ');
  const referencedColumns = foreignKey.referencedColumns.map(quoteOracleIdentifier).join(', ');
  const onDelete = foreignKey.onDelete.toUpperCase();
  const deleteClause = onDelete === 'CASCADE' || onDelete === 'SET NULL' ? ` ON DELETE ${onDelete}` : '';

  return `ALTER TABLE ${quoteOracleIdentifier(table.name)} ADD CONSTRAINT ${quoteOracleIdentifier(
    constraintName,
  )} FOREIGN KEY (${columns}) REFERENCES ${quoteOracleIdentifier(foreignKey.referencedTable)} (${referencedColumns})${deleteClause}`;
}

function buildOracleNativePlan(source: string, tables: NativeTable[], warnings: string[]): OracleNativePlan {
  return {
    source,
    tables,
    ddl: {
      createTables: tables.map(buildCreateTableSql),
      indexes: tables.flatMap(
        (table) => table.indexes.map((index) => buildIndexSql(table, index)).filter(Boolean) as string[],
      ),
      foreignKeys: tables.flatMap((table) =>
        table.foreignKeys.map((foreignKey) => buildForeignKeySql(table, foreignKey)),
      ),
      drops: [...tables]
        .reverse()
        .map((table) => `DROP TABLE ${quoteOracleIdentifier(table.name)} CASCADE CONSTRAINTS PURGE`),
    },
    warnings: [
      ...warnings,
      ...tables.flatMap((table) =>
        table.indexes
          .filter((index) => index.skippedReason && index.origin !== 'pk')
          .map((index) => `Skipped index ${index.name} on ${table.name}: ${index.skippedReason}`),
      ),
    ],
  };
}

async function oracleTableExists(connection: oracledb.Connection, tableName: string): Promise<boolean> {
  const result = await connection.execute<{ OBJECT_COUNT: number }>(
    `SELECT COUNT(*) AS object_count FROM user_tables WHERE table_name = :tableName`,
    { tableName: toOracleIdentifier(tableName) },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return Number(result.rows?.[0]?.OBJECT_COUNT ?? 0) > 0;
}

async function oracleIndexExists(connection: oracledb.Connection, indexName: string): Promise<boolean> {
  const result = await connection.execute<{ OBJECT_COUNT: number }>(
    `SELECT COUNT(*) AS object_count FROM user_indexes WHERE index_name = :indexName`,
    { indexName: toOracleIdentifier(indexName) },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return Number(result.rows?.[0]?.OBJECT_COUNT ?? 0) > 0;
}

async function oracleConstraintExists(connection: oracledb.Connection, constraintName: string): Promise<boolean> {
  const result = await connection.execute<{ OBJECT_COUNT: number }>(
    `SELECT COUNT(*) AS object_count FROM user_constraints WHERE constraint_name = :constraintName`,
    { constraintName: toOracleIdentifier(constraintName) },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return Number(result.rows?.[0]?.OBJECT_COUNT ?? 0) > 0;
}

async function dropNativeTables(
  connection: oracledb.Connection,
  tables: NativeTable[],
  warnings: string[],
): Promise<string[]> {
  const dropped: string[] = [];
  for (const table of [...tables].reverse()) {
    if (!(await oracleTableExists(connection, table.name))) continue;
    try {
      await connection.execute(`DROP TABLE ${quoteOracleIdentifier(table.name)} CASCADE CONSTRAINTS PURGE`);
      dropped.push(table.name);
    } catch (err) {
      warnings.push(`Could not drop ${table.name}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
  return dropped;
}

async function createNativeTables(
  connection: oracledb.Connection,
  tables: NativeTable[],
): Promise<{ createdTables: string[]; skippedExistingTables: string[] }> {
  const createdTables: string[] = [];
  const skippedExistingTables: string[] = [];
  for (const table of tables) {
    if (await oracleTableExists(connection, table.name)) {
      skippedExistingTables.push(table.name);
      continue;
    }
    await connection.execute(buildCreateTableSql(table));
    createdTables.push(table.name);
  }
  return { createdTables, skippedExistingTables };
}

async function createNativeIndexes(
  connection: oracledb.Connection,
  tables: NativeTable[],
): Promise<{ createdIndexes: string[]; skippedExistingIndexes: string[] }> {
  const createdIndexes: string[] = [];
  const skippedExistingIndexes: string[] = [];

  for (const table of tables) {
    for (const index of table.indexes) {
      if (index.skippedReason) continue;
      const rawName = index.name.startsWith('sqlite_autoindex')
        ? shortOracleName('UQ', [table.name, ...index.columns.map((column) => column.name)])
        : index.name;
      const usesUniqueConstraint = shouldUseUniqueConstraint(table, index);
      const objectExists = usesUniqueConstraint
        ? await oracleConstraintExists(connection, rawName)
        : await oracleIndexExists(connection, rawName);
      if (objectExists) {
        skippedExistingIndexes.push(rawName);
        continue;
      }
      const sql = buildIndexSql(table, index);
      if (!sql) continue;
      try {
        await connection.execute(sql);
        createdIndexes.push(rawName);
      } catch (err) {
        if (isOracleErrorCode(err, 'ORA-01408') || isOracleErrorCode(err, 'ORA-02261')) {
          skippedExistingIndexes.push(rawName);
          continue;
        }
        throw err;
      }
    }
  }

  return { createdIndexes, skippedExistingIndexes };
}

function isOracleErrorCode(err: unknown, code: string): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(code);
}

async function createNativeForeignKeys(
  connection: oracledb.Connection,
  tables: NativeTable[],
): Promise<{ createdForeignKeys: string[]; skippedExistingForeignKeys: string[] }> {
  const createdForeignKeys: string[] = [];
  const skippedExistingForeignKeys: string[] = [];

  for (const table of tables) {
    for (const foreignKey of table.foreignKeys) {
      const constraintName = shortOracleName('FK', [table.name, String(foreignKey.id), foreignKey.referencedTable]);
      if (await oracleConstraintExists(connection, constraintName)) {
        skippedExistingForeignKeys.push(constraintName);
        continue;
      }
      const sql = buildForeignKeySql(table, foreignKey);
      try {
        await connection.execute(sql);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to create foreign key ${constraintName} on ${table.name}(${foreignKey.columns.join(
            ', ',
          )}) -> ${foreignKey.referencedTable}(${foreignKey.referencedColumns.join(', ')}): ${message}\n${sql}`,
          { cause: err },
        );
      }
      createdForeignKeys.push(constraintName);
    }
  }

  return { createdForeignKeys, skippedExistingForeignKeys };
}

function orderedTablesForImport(tables: NativeTable[]): NativeTable[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: NativeTable[] = [];

  function visit(table: NativeTable): void {
    if (visited.has(table.name)) return;
    if (visiting.has(table.name)) return;
    visiting.add(table.name);
    for (const foreignKey of table.foreignKeys) {
      if (foreignKey.referencedTable === table.name) continue;
      const parent = byName.get(foreignKey.referencedTable);
      if (parent) visit(parent);
    }
    visiting.delete(table.name);
    visited.add(table.name);
    ordered.push(table);
  }

  for (const table of tables) visit(table);
  return ordered;
}

async function clearNativeRows(connection: oracledb.Connection, tables: NativeTable[]): Promise<void> {
  for (const table of [...orderedTablesForImport(tables)].reverse()) {
    await connection.execute(`DELETE FROM ${quoteOracleIdentifier(table.name)}`);
  }
}

function parseSqliteTimestamp(value: unknown, tableName: string, columnName: string): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;

  if (typeof value === 'number') {
    const milliseconds = Math.abs(value) > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds);
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw);
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '0'] = match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(fraction.padEnd(3, '0').slice(0, 3)),
    );
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  throw new Error(`Invalid timestamp value for ${tableName}.${columnName}: ${raw}`);
}

function normalizeBindValue(value: unknown, column: NativeColumn, tableName: string): unknown {
  if (value === null || value === undefined) return null;
  switch (column.kind) {
    case 'blob':
      return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    case 'clob':
    case 'string':
      return String(value);
    case 'double':
    case 'number':
      return Number(value);
    case 'timestamp':
      return parseSqliteTimestamp(value, tableName, column.name);
  }
}

function bindDefsForTable(table: NativeTable): Record<string, oracledb.BindDefinition> {
  const bindDefs: Record<string, oracledb.BindDefinition> = {};
  table.columns.forEach((column, index) => {
    const name = `b${index}`;
    switch (column.kind) {
      case 'blob':
        bindDefs[name] = { type: oracledb.DB_TYPE_BLOB };
        break;
      case 'clob':
        bindDefs[name] = { type: oracledb.DB_TYPE_CLOB };
        break;
      case 'double':
        bindDefs[name] = { type: oracledb.DB_TYPE_BINARY_DOUBLE };
        break;
      case 'number':
        bindDefs[name] = { type: oracledb.DB_TYPE_NUMBER };
        break;
      case 'timestamp':
        bindDefs[name] = { type: oracledb.DB_TYPE_TIMESTAMP };
        break;
      case 'string':
        bindDefs[name] = { type: oracledb.DB_TYPE_VARCHAR, maxSize: column.maxStringSize ?? MAX_ORACLE_VARCHAR_SIZE };
        break;
    }
  });
  return bindDefs;
}

function buildMergeSql(table: NativeTable): string {
  const sourceColumns = table.columns
    .map((column, index) => `:${`b${index}`} ${quoteOracleIdentifier(column.name)}`)
    .join(', ');
  const onClause = table.primaryKey
    .map((column) => `dst.${quoteOracleIdentifier(column)} = src.${quoteOracleIdentifier(column)}`)
    .join(' AND ');
  const nonPrimaryColumns = table.columns.filter((column) => !table.primaryKey.includes(column.name));
  const insertColumns = table.columns.map((column) => quoteOracleIdentifier(column.name)).join(', ');
  const insertValues = table.columns.map((column) => `src.${quoteOracleIdentifier(column.name)}`).join(', ');

  const clauses = [
    `MERGE INTO ${quoteOracleIdentifier(table.name)} dst`,
    `USING (SELECT ${sourceColumns} FROM dual) src`,
    `ON (${onClause})`,
  ];
  if (nonPrimaryColumns.length > 0) {
    clauses.push(
      `WHEN MATCHED THEN UPDATE SET ${nonPrimaryColumns
        .map((column) => `dst.${quoteOracleIdentifier(column.name)} = src.${quoteOracleIdentifier(column.name)}`)
        .join(', ')}`,
    );
  }
  clauses.push(`WHEN NOT MATCHED THEN INSERT (${insertColumns}) VALUES (${insertValues})`);
  return clauses.join('\n');
}

function buildInsertSql(table: NativeTable): string {
  const columns = table.columns.map((column) => quoteOracleIdentifier(column.name)).join(', ');
  const values = table.columns.map((_, index) => `:b${index}`).join(', ');
  return `INSERT INTO ${quoteOracleIdentifier(table.name)} (${columns}) VALUES (${values})`;
}

async function importTableRows(
  sqlite: Database.Database,
  connection: oracledb.Connection,
  table: NativeTable,
  batchSize: number,
): Promise<number> {
  if (table.columns.length === 0) return 0;

  const columnList = table.columns.map((column) => quoteSqliteIdentifier(column.name)).join(', ');
  const orderBy =
    table.primaryKey.length > 0 ? ` ORDER BY ${table.primaryKey.map(quoteSqliteIdentifier).join(', ')}` : '';
  const statement = sqlite.prepare(`SELECT ${columnList} FROM ${quoteSqliteIdentifier(table.name)}${orderBy}`);
  const sql = table.primaryKey.length > 0 ? buildMergeSql(table) : buildInsertSql(table);
  const bindDefs = bindDefsForTable(table);
  let imported = 0;
  let batch: Record<string, unknown>[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await connection.executeMany(sql, batch, { bindDefs });
    imported += batch.length;
    batch = [];
  };

  for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
    const bind: Record<string, unknown> = {};
    table.columns.forEach((column, index) => {
      bind[`b${index}`] = normalizeBindValue(row[column.name], column, table.name);
    });
    batch.push(bind);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  return imported;
}

async function syncIdentityStarts(
  connection: oracledb.Connection,
  tables: NativeTable[],
  warnings: string[],
): Promise<void> {
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.identity) continue;
      try {
        await connection.execute(
          `ALTER TABLE ${quoteOracleIdentifier(table.name)} MODIFY ${quoteOracleIdentifier(
            column.name,
          )} GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        );
      } catch (err) {
        warnings.push(
          `Could not sync identity start for ${table.name}.${column.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}

function emptySchemaResult(source: string, warnings: string[]): OracleNativeSchemaResult {
  return {
    ok: true,
    source,
    tableCount: 0,
    createdTables: [],
    skippedExistingTables: [],
    droppedTables: [],
    createdIndexes: [],
    skippedExistingIndexes: [],
    createdForeignKeys: [],
    skippedExistingForeignKeys: [],
    warnings,
  };
}

export async function createOracleNativeSchema(
  sqlitePath = resolveNativeSqliteDbPath(),
  options: OracleNativeSchemaOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<OracleNativeSchemaResult> {
  const config = getOracleAutonomousConfigFromEnv(env);
  if (!config) {
    throw new Error(
      [
        'Missing Oracle Autonomous DB environment.',
        'Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
        'If you use a wallet, also set ORACLE_DB_WALLET_LOCATION or TNS_ADMIN.',
      ].join(' '),
    );
  }

  const plan = readSqliteNativeSchema(sqlitePath);
  const result = emptySchemaResult(sqlitePath, [...plan.warnings]);
  result.tableCount = plan.tables.length;

  const connection = await openOracleAutonomousConnection(config);
  try {
    if (options.dropExisting) result.droppedTables = await dropNativeTables(connection, plan.tables, result.warnings);

    const tables = await createNativeTables(connection, plan.tables);
    result.createdTables = tables.createdTables;
    result.skippedExistingTables = tables.skippedExistingTables;

    const indexes = await createNativeIndexes(connection, plan.tables);
    result.createdIndexes = indexes.createdIndexes;
    result.skippedExistingIndexes = indexes.skippedExistingIndexes;

    if (options.includeForeignKeys !== false) {
      const foreignKeys = await createNativeForeignKeys(connection, plan.tables);
      result.createdForeignKeys = foreignKeys.createdForeignKeys;
      result.skippedExistingForeignKeys = foreignKeys.skippedExistingForeignKeys;
    }

    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    await connection.close();
  }
}

export async function importSqliteToNativeOracle(
  sqlitePath = resolveNativeSqliteDbPath(),
  options: OracleNativeImportOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<OracleNativeImportResult> {
  const config = getOracleAutonomousConfigFromEnv(env);
  if (!config) {
    throw new Error(
      [
        'Missing Oracle Autonomous DB environment.',
        'Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
        'If you use a wallet, also set ORACLE_DB_WALLET_LOCATION or TNS_ADMIN.',
      ].join(' '),
    );
  }

  const plan = readSqliteNativeSchema(sqlitePath);
  const result: OracleNativeImportResult = {
    ...emptySchemaResult(sqlitePath, [...plan.warnings]),
    tableCount: plan.tables.length,
    rowCount: 0,
    tableRows: [],
  };
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const connection = await openOracleAutonomousConnection(config);

  try {
    if (options.dropExisting) result.droppedTables = await dropNativeTables(connection, plan.tables, result.warnings);

    const tables = await createNativeTables(connection, plan.tables);
    result.createdTables = tables.createdTables;
    result.skippedExistingTables = tables.skippedExistingTables;

    if (options.clearExisting) await clearNativeRows(connection, plan.tables);

    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    for (const table of orderedTablesForImport(plan.tables)) {
      const rows = await importTableRows(sqlite, connection, table, batchSize);
      result.rowCount += rows;
      result.tableRows.push({ table: table.name, rows });
      await connection.commit();
    }

    await syncIdentityStarts(connection, plan.tables, result.warnings);

    const indexes = await createNativeIndexes(connection, plan.tables);
    result.createdIndexes = indexes.createdIndexes;
    result.skippedExistingIndexes = indexes.skippedExistingIndexes;

    if (options.includeForeignKeys !== false) {
      const foreignKeys = await createNativeForeignKeys(connection, plan.tables);
      result.createdForeignKeys = foreignKeys.createdForeignKeys;
      result.skippedExistingForeignKeys = foreignKeys.skippedExistingForeignKeys;
    }

    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    sqlite.close();
    await connection.close();
  }
}
