import { mirrorSqliteToOracle, resolveSqliteDbPath } from '../src/db/oracleSqliteMirror';

async function main(): Promise<void> {
  const result = await mirrorSqliteToOracle(resolveSqliteDbPath());
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
