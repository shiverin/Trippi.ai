import { tripsApi } from '../api/client'
import { offlineDb, upsertTrip } from '../db/offlineDb'
import { onlineThenCache } from './withOfflineFallback'
import type { Trip } from '../types'

async function readCachedTrips(): Promise<{ trips: Trip[]; archivedTrips: Trip[] } | null> {
  const all = await offlineDb.trips.toArray()
  const cached = {
    trips: all.filter(t => !t.is_archived),
    archivedTrips: all.filter(t => t.is_archived),
  }
  if (cached.trips.length === 0 && cached.archivedTrips.length === 0) return null
  return cached
}

export const tripRepo = {
  async listCached(): Promise<{ trips: Trip[]; archivedTrips: Trip[] } | null> {
    return readCachedTrips()
  },

  async list(): Promise<{ trips: Trip[]; archivedTrips: Trip[] }> {
    const readCachedTrips = async () => {
      const cached = await tripRepo.listCached()
      if (!cached) throw new Error('No cached trips available')
      return cached
    }

    return onlineThenCache(
      async () => {
        const [active, archived] = await Promise.all([
          tripsApi.list(),
          tripsApi.list({ archived: 1 }),
        ])
        active.trips.forEach(t => upsertTrip(t))
        archived.trips.forEach(t => upsertTrip(t))
        return { trips: active.trips, archivedTrips: archived.trips }
      },
      readCachedTrips,
    )
  },

  async get(tripId: number | string): Promise<{ trip: Trip }> {
    return onlineThenCache(
      async () => {
        const result = await tripsApi.get(tripId)
        upsertTrip(result.trip)
        return result
      },
      async () => {
        const cached = await offlineDb.trips.get(Number(tripId))
        if (cached) return { trip: cached }
        throw new Error('No cached trip data available offline')
      },
    )
  },
}
