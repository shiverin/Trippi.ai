import { create } from 'zustand';
import { categoriesApi, tagsApi, tripsApi } from '../api/client';
import {
  offlineDb,
  upsertAccommodations,
  upsertBudgetItems,
  upsertDays,
  upsertPackingItems,
  upsertPlaces,
  upsertReservations,
  upsertTodoItems,
  upsertTrip,
  upsertTripFiles,
  upsertTripMembers,
} from '../db/offlineDb';
import { budgetRepo } from '../repo/budgetRepo';
import { dayRepo } from '../repo/dayRepo';
import { fileRepo } from '../repo/fileRepo';
import { packingRepo } from '../repo/packingRepo';
import { placeRepo } from '../repo/placeRepo';
import { reservationRepo } from '../repo/reservationRepo';
import { todoRepo } from '../repo/todoRepo';
import { tripRepo } from '../repo/tripRepo';
import type {
  Accommodation,
  AssignmentsMap,
  BudgetItem,
  Category,
  Day,
  DayNotesMap,
  PackingItem,
  Place,
  Reservation,
  Tag,
  TodoItem,
  Trip,
  TripFile,
  TripMember,
  WebSocketEvent,
} from '../types';
import { getApiErrorMessage } from '../types';
import type { AssignmentsSlice } from './slices/assignmentsSlice';
import { createAssignmentsSlice } from './slices/assignmentsSlice';
import type { BudgetSlice } from './slices/budgetSlice';
import { createBudgetSlice } from './slices/budgetSlice';
import type { DayNotesSlice } from './slices/dayNotesSlice';
import { createDayNotesSlice } from './slices/dayNotesSlice';
import type { DaysSlice } from './slices/daysSlice';
import { createDaysSlice } from './slices/daysSlice';
import type { FilesSlice } from './slices/filesSlice';
import { createFilesSlice } from './slices/filesSlice';
import type { PackingSlice } from './slices/packingSlice';
import { createPackingSlice } from './slices/packingSlice';
import type { PlacesSlice } from './slices/placesSlice';
import { createPlacesSlice } from './slices/placesSlice';
import { handleRemoteEvent } from './slices/remoteEventHandler';
import type { ReservationsSlice } from './slices/reservationsSlice';
import { createReservationsSlice } from './slices/reservationsSlice';
import type { TodoSlice } from './slices/todoSlice';
import { createTodoSlice } from './slices/todoSlice';

interface TripLoadExtras {
  accommodations: Accommodation[];
  members: TripMember[];
}

interface TripBundleResponse extends TripLoadExtras {
  trip: Trip;
  days: Day[];
  places: Place[];
  packingItems: PackingItem[];
  todoItems: TodoItem[];
  budgetItems: BudgetItem[];
  reservations: Reservation[];
  files: TripFile[];
}

interface CachedTripBundleResponse extends TripBundleResponse {
  tags: Tag[];
  categories: Category[];
}

function buildDayMaps(days: Day[]): { assignments: AssignmentsMap; dayNotes: DayNotesMap } {
  const assignments: AssignmentsMap = {};
  const dayNotes: DayNotesMap = {};
  for (const day of days) {
    assignments[String(day.id)] = day.assignments || [];
    dayNotes[String(day.id)] = day.notes_items || [];
  }
  return { assignments, dayNotes };
}

async function cacheTripBundle(bundle: TripBundleResponse): Promise<void> {
  await Promise.all([
    upsertTrip(bundle.trip),
    upsertDays(bundle.days),
    upsertPlaces(bundle.places),
    upsertPackingItems(bundle.packingItems),
    upsertTodoItems(bundle.todoItems),
    upsertBudgetItems(bundle.budgetItems),
    upsertReservations(bundle.reservations),
    upsertTripFiles(bundle.files),
    upsertAccommodations(bundle.accommodations || []),
    upsertTripMembers(bundle.trip.id, bundle.members || []),
  ]);
}

async function readCachedTripBundle(tripId: number | string): Promise<CachedTripBundleResponse | null> {
  const numericTripId = Number(tripId);
  const [
    trip,
    days,
    places,
    packingItems,
    todoItems,
    budgetItems,
    reservations,
    files,
    accommodations,
    members,
    tags,
    categories,
  ] = await Promise.all([
    offlineDb.trips.get(numericTripId),
    offlineDb.days.where('trip_id').equals(numericTripId).sortBy('position'),
    offlineDb.places.where('trip_id').equals(numericTripId).toArray(),
    offlineDb.packingItems.where('trip_id').equals(numericTripId).toArray(),
    offlineDb.todoItems.where('trip_id').equals(numericTripId).toArray(),
    offlineDb.budgetItems.where('trip_id').equals(numericTripId).toArray(),
    offlineDb.reservations.where('trip_id').equals(numericTripId).toArray(),
    offlineDb.tripFiles.where('trip_id').equals(numericTripId).toArray(),
    offlineDb.accommodations.where('trip_id').equals(numericTripId).toArray(),
    offlineDb.tripMembers.where('tripId').equals(numericTripId).toArray(),
    offlineDb.tags.toArray(),
    offlineDb.categories.toArray(),
  ]);

  if (!trip) return null;

  return {
    trip,
    days,
    places,
    packingItems,
    todoItems,
    budgetItems,
    reservations,
    files,
    accommodations,
    members,
    tags,
    categories,
  };
}

function applyTripBundle(
  set: (partial: Partial<TripStoreState>) => void,
  bundle: TripBundleResponse,
  tags: Tag[],
  categories: Category[]
): void {
  const { assignments, dayNotes } = buildDayMaps(bundle.days);
  set({
    trip: bundle.trip,
    days: bundle.days,
    places: bundle.places,
    assignments,
    dayNotes,
    packingItems: bundle.packingItems,
    todoItems: bundle.todoItems,
    budgetItems: bundle.budgetItems,
    reservations: bundle.reservations,
    files: bundle.files,
    tags,
    categories,
    isLoading: false,
  });
}

export interface TripStoreState
  extends
    PlacesSlice,
    AssignmentsSlice,
    DaysSlice,
    DayNotesSlice,
    PackingSlice,
    TodoSlice,
    BudgetSlice,
    ReservationsSlice,
    FilesSlice {
  trip: Trip | null;
  days: Day[];
  places: Place[];
  assignments: AssignmentsMap;
  dayNotes: DayNotesMap;
  packingItems: PackingItem[];
  todoItems: TodoItem[];
  tags: Tag[];
  categories: Category[];
  budgetItems: BudgetItem[];
  files: TripFile[];
  reservations: Reservation[];
  selectedDayId: number | null;
  isLoading: boolean;
  error: string | null;

  setSelectedDay: (dayId: number | null) => void;
  handleRemoteEvent: (event: WebSocketEvent) => void;
  resetTrip: () => void;
  loadTrip: (tripId: number | string) => Promise<TripLoadExtras | void>;
  hydrateActiveTrip: (tripId: number | string) => Promise<void>;
  refreshDays: (tripId: number | string) => Promise<void>;
  updateTrip: (tripId: number | string, data: Partial<Trip>) => Promise<Trip>;
  addTag: (data: Partial<Tag> & { name: string }) => Promise<Tag>;
  addCategory: (data: Partial<Category> & { name: string }) => Promise<Category>;
}

export const useTripStore = create<TripStoreState>((set, get) => ({
  trip: null,
  days: [],
  places: [],
  assignments: {},
  dayNotes: {},
  packingItems: [],
  todoItems: [],
  tags: [],
  categories: [],
  budgetItems: [],
  files: [],
  reservations: [],
  selectedDayId: null,
  isLoading: false,
  error: null,

  setSelectedDay: (dayId: number | null) => set({ selectedDayId: dayId }),

  handleRemoteEvent: (event: WebSocketEvent) => handleRemoteEvent(set, get, event),

  // Clear every trip-scoped slice so switching trips (or losing access to one)
  // can never leave a previous trip's data visible. Global tags/categories are
  // left intact. Called at the top of loadTrip.
  resetTrip: () =>
    set({
      trip: null,
      days: [],
      places: [],
      assignments: {},
      dayNotes: {},
      packingItems: [],
      todoItems: [],
      budgetItems: [],
      files: [],
      reservations: [],
      selectedDayId: null,
      error: null,
    }),

  loadTrip: async (tripId: number | string) => {
    get().resetTrip();
    set({ isLoading: true, error: null });
    try {
      if (navigator.onLine) {
        const bundlePromise = tripsApi.bundle(tripId) as Promise<TripBundleResponse>;
        const tagsPromise = tagsApi.list().catch(() => offlineDb.tags.toArray().then((tags) => ({ tags })));
        const categoriesPromise = categoriesApi
          .list()
          .catch(() => offlineDb.categories.toArray().then((categories) => ({ categories })));

        let appliedFreshBundle = false;
        readCachedTripBundle(tripId)
          .then((cachedBundle) => {
            if (!cachedBundle || appliedFreshBundle) return;
            applyTripBundle(set, cachedBundle, cachedBundle.tags, cachedBundle.categories);
          })
          .catch(() => {});

        const [bundle, tagsData, categoriesData] = await Promise.all([bundlePromise, tagsPromise, categoriesPromise]);
        appliedFreshBundle = true;
        applyTripBundle(set, bundle, tagsData.tags, categoriesData.categories);
        cacheTripBundle(bundle).catch((err) => {
          console.warn('[tripStore] failed to cache trip bundle', err);
        });

        return { accommodations: bundle.accommodations || [], members: bundle.members || [] };
      }

      const [
        tripData,
        daysData,
        placesData,
        packingData,
        todoData,
        budgetData,
        reservationsData,
        filesData,
        tagsData,
        categoriesData,
      ] = await Promise.all([
        tripRepo.get(tripId),
        dayRepo.list(tripId),
        placeRepo.list(tripId),
        packingRepo.list(tripId),
        todoRepo.list(tripId),
        // Budget / reservations / files are hydrated here too so the offline
        // path is uniform (no separate tab-gated effects). Non-fatal: a failure
        // in any of these must not blank the whole trip.
        budgetRepo.list(tripId).catch(() => ({ items: [] as BudgetItem[] })),
        reservationRepo.list(tripId).catch(() => ({ reservations: [] as Reservation[] })),
        fileRepo.list(tripId).catch(() => ({ files: [] as TripFile[] })),
        navigator.onLine
          ? tagsApi.list().catch(() => offlineDb.tags.toArray().then((tags) => ({ tags })))
          : offlineDb.tags.toArray().then((tags) => ({ tags })),
        navigator.onLine
          ? categoriesApi.list().catch(() => offlineDb.categories.toArray().then((categories) => ({ categories })))
          : offlineDb.categories.toArray().then((categories) => ({ categories })),
      ]);

      const { assignments, dayNotes } = buildDayMaps(daysData.days);
      const [accommodations, members] = await Promise.all([
        offlineDb.accommodations.where('trip_id').equals(Number(tripId)).toArray(),
        offlineDb.tripMembers.where('tripId').equals(Number(tripId)).toArray(),
      ]);

      set({
        trip: tripData.trip,
        days: daysData.days,
        places: placesData.places,
        assignments,
        dayNotes,
        packingItems: packingData.items,
        todoItems: todoData.items,
        budgetItems: budgetData.items,
        reservations: reservationsData.reservations,
        files: filesData.files,
        tags: tagsData.tags,
        categories: categoriesData.categories,
        isLoading: false,
      });
      return { accommodations, members };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // Silently re-fetch the active trip's collaborative state into the store after
  // the network comes back (WS reconnect or `online` event) so edits missed while
  // offline appear in place — no splash, no resetTrip. Each resource is
  // best-effort; a failure on one must not wipe the others.
  hydrateActiveTrip: async (tripId: number | string) => {
    await Promise.all([
      get().refreshDays(tripId),
      placeRepo
        .list(tripId)
        .then((d) => set({ places: d.places }))
        .catch(() => {}),
      packingRepo
        .list(tripId)
        .then((d) => set({ packingItems: d.items }))
        .catch(() => {}),
      todoRepo
        .list(tripId)
        .then((d) => set({ todoItems: d.items }))
        .catch(() => {}),
      get().loadBudgetItems(tripId),
      get().loadReservations(tripId),
      get().loadFiles(tripId),
    ]);
  },

  refreshDays: async (tripId: number | string) => {
    try {
      const daysData = await dayRepo.list(tripId);
      const assignmentsMap: AssignmentsMap = {};
      const dayNotesMap: DayNotesMap = {};
      for (const day of daysData.days) {
        assignmentsMap[String(day.id)] = day.assignments || [];
        dayNotesMap[String(day.id)] = day.notes_items || [];
      }
      set({ days: daysData.days, assignments: assignmentsMap, dayNotes: dayNotesMap });
    } catch (err: unknown) {
      console.error('Failed to refresh days:', err);
    }
  },

  updateTrip: async (tripId: number | string, data: Partial<Trip>) => {
    try {
      const result = await tripsApi.update(tripId, data);
      set({ trip: result.trip });
      const daysData = await dayRepo.list(tripId);
      const assignmentsMap: AssignmentsMap = {};
      const dayNotesMap: DayNotesMap = {};
      for (const day of daysData.days) {
        assignmentsMap[String(day.id)] = day.assignments || [];
        dayNotesMap[String(day.id)] = day.notes_items || [];
      }
      set({ days: daysData.days, assignments: assignmentsMap, dayNotes: dayNotesMap });
      return result.trip;
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error updating trip'));
    }
  },

  addTag: async (data: Partial<Tag> & { name: string }) => {
    try {
      const result = await tagsApi.create(data);
      set((state) => ({ tags: [...state.tags, result.tag] }));
      return result.tag;
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error creating tag'));
    }
  },

  addCategory: async (data: Partial<Category> & { name: string }) => {
    try {
      const result = await categoriesApi.create(data);
      set((state) => ({ categories: [...state.categories, result.category] }));
      return result.category;
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error creating category'));
    }
  },

  ...createPlacesSlice(set, get),
  ...createAssignmentsSlice(set, get),
  ...createDaysSlice(set, get),
  ...createDayNotesSlice(set, get),
  ...createPackingSlice(set, get),
  ...createTodoSlice(set, get),
  ...createBudgetSlice(set, get),
  ...createReservationsSlice(set, get),
  ...createFilesSlice(set, get),
}));
