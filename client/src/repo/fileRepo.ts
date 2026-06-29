import { filesApi } from '../api/client';
import { offlineDb, upsertTripFiles } from '../db/offlineDb';
import type { TripFile } from '../types';
import { onlineThenCache } from './withOfflineFallback';

export const fileRepo = {
  async list(tripId: number | string): Promise<{ files: TripFile[] }> {
    return onlineThenCache(
      async () => {
        const result = await filesApi.list(tripId);
        upsertTripFiles(result.files);
        return result;
      },
      async () => ({
        files: await offlineDb.tripFiles.where('trip_id').equals(Number(tripId)).toArray(),
      })
    );
  },
};
