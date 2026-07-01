import {
  getStats,
  getCountryPlacesAsync,
  markCountryVisitedAsync,
  unmarkCountryVisitedAsync,
  markRegionVisitedAsync,
  unmarkRegionVisitedAsync,
  getVisitedRegions,
  getRegionGeo,
  getCountryGeo,
  createBucketItem,
  createBucketItemAsync,
  updateBucketItem,
  updateBucketItemAsync,
  deleteBucketItemAsync,
  listBucketListAsync,
} from '../../services/atlasService';
import { Injectable } from '@nestjs/common';

type CreateBucketData = Parameters<typeof createBucketItem>[1];
type UpdateBucketData = Parameters<typeof updateBucketItem>[2];

/**
 * Thin Nest wrapper around the existing atlas service. The Admin-1 GeoJSON
 * cache, the stats aggregation and the visited-region logic all stay in
 * atlasService, so behaviour is unchanged. Returns native service shapes; the
 * client-facing contracts live in @trippi/shared.
 */
@Injectable()
export class AtlasService {
  stats(userId: number) {
    return getStats(userId);
  }

  async bootstrap(userId: number) {
    const [stats, bucketList, visitedRegions] = await Promise.all([
      getStats(userId),
      listBucketListAsync(userId),
      getVisitedRegions(userId),
    ]);
    return {
      stats,
      bucketList,
      items: bucketList,
      visitedRegions,
      regions: visitedRegions.regions,
    };
  }

  visitedRegions(userId: number) {
    return getVisitedRegions(userId);
  }

  regionGeo(countries: string[]) {
    return getRegionGeo(countries);
  }

  countryGeo() {
    return getCountryGeo();
  }

  countryPlaces(userId: number, code: string) {
    return getCountryPlacesAsync(userId, code);
  }

  markCountry(userId: number, code: string) {
    return markCountryVisitedAsync(userId, code);
  }

  unmarkCountry(userId: number, code: string) {
    return unmarkCountryVisitedAsync(userId, code);
  }

  markRegion(userId: number, code: string, name: string, countryCode: string) {
    return markRegionVisitedAsync(userId, code, name, countryCode);
  }

  unmarkRegion(userId: number, code: string) {
    return unmarkRegionVisitedAsync(userId, code);
  }

  bucketList(userId: number) {
    return listBucketListAsync(userId);
  }

  createBucketItem(userId: number, data: CreateBucketData) {
    return createBucketItemAsync(userId, data);
  }

  updateBucketItem(userId: number, itemId: string, data: UpdateBucketData) {
    return updateBucketItemAsync(userId, itemId, data);
  }

  deleteBucketItem(userId: number, itemId: string) {
    return deleteBucketItemAsync(userId, itemId);
  }
}
