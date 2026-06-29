import {
  importSqliteToNativeOracle,
  readSqliteNativeSchema,
  resolveNativeSqliteDbPath,
} from '../src/db/oracleNativeSchema';

interface CliOptions {
  batchSize: number;
  clearExisting: boolean;
  dropExisting: boolean;
  dryRun: boolean;
  includeForeignKeys: boolean;
  sqlitePath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    batchSize: 250,
    clearExisting: false,
    dropExisting: false,
    dryRun: false,
    includeForeignKeys: true,
    sqlitePath: resolveNativeSqliteDbPath(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--batch-size') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--batch-size requires a positive integer.');
      options.batchSize = value;
      index += 1;
    } else if (arg === '--clear-existing') options.clearExisting = true;
    else if (arg === '--drop-existing') options.dropExisting = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-foreign-keys') options.includeForeignKeys = false;
    else if (arg === '--sqlite') {
      const sqlitePath = argv[index + 1];
      if (!sqlitePath) throw new Error('--sqlite requires a file path.');
      options.sqlitePath = sqlitePath;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.dryRun) {
    const plan = readSqliteNativeSchema(options.sqlitePath);
    console.log(
      JSON.stringify(
        {
          ok: true,
          source: plan.source,
          tableCount: plan.tables.length,
          rowCount: plan.tables.reduce((sum, table) => sum + table.rowCount, 0),
          batchSize: options.batchSize,
          wouldDropExisting: options.dropExisting,
          wouldClearExisting: options.clearExisting,
          wouldCreateForeignKeys: options.includeForeignKeys,
          tableRows: plan.tables.map((table) => ({ table: table.name, rows: table.rowCount })),
          warnings: plan.warnings,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await importSqliteToNativeOracle(options.sqlitePath, {
    batchSize: options.batchSize,
    clearExisting: options.clearExisting,
    dropExisting: options.dropExisting,
    includeForeignKeys: options.includeForeignKeys,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
