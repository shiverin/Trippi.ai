import {
  createOracleNativeSchema,
  readSqliteNativeSchema,
  resolveNativeSqliteDbPath,
} from '../src/db/oracleNativeSchema';

interface CliOptions {
  dropExisting: boolean;
  dryRun: boolean;
  includeForeignKeys: boolean;
  printDdl: boolean;
  sqlitePath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dropExisting: false,
    dryRun: false,
    includeForeignKeys: true,
    printDdl: false,
    sqlitePath: resolveNativeSqliteDbPath(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--drop-existing') options.dropExisting = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-foreign-keys') options.includeForeignKeys = false;
    else if (arg === '--print-ddl') options.printDdl = true;
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
          createTableCount: plan.ddl.createTables.length,
          indexCount: plan.ddl.indexes.length,
          foreignKeyCount: options.includeForeignKeys ? plan.ddl.foreignKeys.length : 0,
          warnings: plan.warnings,
          ddl: options.printDdl
            ? [
                ...(options.dropExisting ? plan.ddl.drops : []),
                ...plan.ddl.createTables,
                ...plan.ddl.indexes,
                ...(options.includeForeignKeys ? plan.ddl.foreignKeys : []),
              ]
            : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await createOracleNativeSchema(options.sqlitePath, {
    dropExisting: options.dropExisting,
    includeForeignKeys: options.includeForeignKeys,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
