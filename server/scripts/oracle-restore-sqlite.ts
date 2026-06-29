import { resolveSqliteDbPath, restoreSqliteFromOracle } from '../src/db/oracleSqliteMirror';

async function main(): Promise<void> {
  const result = await restoreSqliteFromOracle(resolveSqliteDbPath());
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
