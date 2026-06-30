import { closeAsyncDb } from '../src/db/asyncDatabase';
import { runMediaBackfill } from '../src/scripts/mediaBackfill';

runMediaBackfill()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAsyncDb();
  });
