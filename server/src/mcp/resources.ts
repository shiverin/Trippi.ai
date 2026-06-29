import { ADDON_IDS } from '../addons';
import { canAccessTripAsync as canAccessTrip } from '../db/asyncDatabase';
import { getCollabFeaturesAsync, isAddonEnabledAsync } from '../services/adminService';
import {
  listBucketListAsync as listBucketList,
  listVisitedCountriesAsync as listVisitedCountries,
  getStats as getAtlasStats,
  listManuallyVisitedRegionsAsync as listManuallyVisitedRegions,
} from '../services/atlasService';
import { listBudgetItems, getPerPersonSummary, calculateSettlement } from '../services/budgetService';
import { listCategoriesAsync } from '../services/categoryService';
import {
  listMessagesAsync as listMessages,
  listNotesAsync as listCollabNotes,
  listPollsAsync as listPolls,
} from '../services/collabService';
import { listNotes as listDayNotes } from '../services/dayNoteService';
import { listDays, listAccommodations } from '../services/dayService';
import { getNotificationsAsync } from '../services/inAppNotifications';
import { canAccessJourney, getJourneyFull, listEntries, listJourneys } from '../services/journeyService';
import { listItems as listPackingItems, listBags } from '../services/packingService';
import { listPlacesAsync } from '../services/placeService';
import { listReservations } from '../services/reservationService';
import { listItems as listTodoItems } from '../services/todoService';
import { listTrips, getTrip, getTripOwner, listMembers } from '../services/tripService';
import {
  getActivePlanId,
  getActivePlan,
  getPlanData,
  getEntries as getVacayEntries,
  getHolidays,
} from '../services/vacayService';
import { canRead, canReadTrips } from './scopes';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp';

function parseId(value: string | string[]): number | null {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function accessDenied(uri: string) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Trip not found or access denied' }),
      },
    ],
  };
}

function scopeDenied(uri: string) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Insufficient OAuth scope to access this resource' }),
      },
    ],
  };
}

function jsonContent(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export async function registerResources(server: McpServer, userId: number, scopes: string[] | null): Promise<void> {
  const budgetEnabled = await isAddonEnabledAsync(ADDON_IDS.BUDGET);
  const packingEnabled = await isAddonEnabledAsync(ADDON_IDS.PACKING);
  const atlasEnabled = await isAddonEnabledAsync(ADDON_IDS.ATLAS);
  const collabEnabled = await isAddonEnabledAsync(ADDON_IDS.COLLAB);
  const vacayEnabled = await isAddonEnabledAsync(ADDON_IDS.VACAY);
  const journeyEnabled = await isAddonEnabledAsync(ADDON_IDS.JOURNEY);
  const collabFeatures = collabEnabled ? await getCollabFeaturesAsync() : null;

  // List all accessible trips
  if (canReadTrips(scopes))
    server.registerResource(
      'trips',
      'trippi://trips',
      { description: 'All trips the user owns or is a member of', mimeType: 'application/json' },
      async (uri) => {
        const trips = listTrips(userId, 0);
        return jsonContent(uri.href, trips);
      },
    );

  // Single trip detail
  if (canReadTrips(scopes))
    server.registerResource(
      'trip',
      new ResourceTemplate('trippi://trips/{tripId}', { list: undefined }),
      { description: 'A single trip with metadata and member count', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const trip = getTrip(id, userId);
        return jsonContent(uri.href, trip);
      },
    );

  // Days with assigned places
  if (canReadTrips(scopes))
    server.registerResource(
      'trip-days',
      new ResourceTemplate('trippi://trips/{tripId}/days', { list: undefined }),
      { description: 'Days of a trip with their assigned places', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);

        const { days } = await listDays(id);
        return jsonContent(uri.href, days);
      },
    );

  // Places in a trip
  if (canRead(scopes, 'places'))
    server.registerResource(
      'trip-places',
      new ResourceTemplate('trippi://trips/{tripId}/places', { list: undefined }),
      {
        description:
          'All places/POIs in a trip, optionally filtered by assignment status (e.g. ?assignment=unassigned)',
        mimeType: 'application/json',
      },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const assignment = uri.searchParams.get('assignment') as 'all' | 'unassigned' | 'assigned' | null;
        const places = await listPlacesAsync(String(id), { assignment: assignment ?? undefined });
        return jsonContent(uri.href, places);
      },
    );

  // Budget items
  if (budgetEnabled && canRead(scopes, 'budget'))
    server.registerResource(
      'trip-budget',
      new ResourceTemplate('trippi://trips/{tripId}/budget', { list: undefined }),
      { description: 'Budget and expense items for a trip', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const items = await listBudgetItems(id);
        return jsonContent(uri.href, items);
      },
    );

  // Packing checklist
  if (packingEnabled && canRead(scopes, 'packing'))
    server.registerResource(
      'trip-packing',
      new ResourceTemplate('trippi://trips/{tripId}/packing', { list: undefined }),
      { description: 'Packing checklist for a trip', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const items = await listPackingItems(id);
        return jsonContent(uri.href, items);
      },
    );

  // Reservations (flights, hotels, restaurants)
  if (canRead(scopes, 'reservations'))
    server.registerResource(
      'trip-reservations',
      new ResourceTemplate('trippi://trips/{tripId}/reservations', { list: undefined }),
      { description: 'Reservations (flights, hotels, restaurants) for a trip', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const reservations = await listReservations(id);
        return jsonContent(uri.href, reservations);
      },
    );

  // Day notes
  if (canReadTrips(scopes))
    server.registerResource(
      'day-notes',
      new ResourceTemplate('trippi://trips/{tripId}/days/{dayId}/notes', { list: undefined }),
      { description: 'Notes for a specific day in a trip', mimeType: 'application/json' },
      async (uri, { tripId, dayId }) => {
        const tId = parseId(tripId);
        const dId = parseId(dayId);
        if (tId === null || dId === null || !(await canAccessTrip(tId, userId))) return accessDenied(uri.href);
        const notes = await listDayNotes(dId, tId);
        return jsonContent(uri.href, notes);
      },
    );

  // Accommodations (hotels, rentals) per trip
  if (canReadTrips(scopes))
    server.registerResource(
      'trip-accommodations',
      new ResourceTemplate('trippi://trips/{tripId}/accommodations', { list: undefined }),
      {
        description: 'Accommodations (hotels, rentals) for a trip with check-in/out details',
        mimeType: 'application/json',
      },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const accommodations = await listAccommodations(id);
        return jsonContent(uri.href, accommodations);
      },
    );

  // Trip members (owner + collaborators)
  if (canReadTrips(scopes))
    server.registerResource(
      'trip-members',
      new ResourceTemplate('trippi://trips/{tripId}/members', { list: undefined }),
      { description: 'Owner and collaborators of a trip', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const ownerRow = getTripOwner(id);
        if (!ownerRow) return accessDenied(uri.href);
        const { owner, members } = listMembers(id, ownerRow.user_id);
        return jsonContent(uri.href, { owner, members });
      },
    );

  // Collab notes for a trip
  if (collabFeatures?.notes && canRead(scopes, 'collab'))
    server.registerResource(
      'trip-collab-notes',
      new ResourceTemplate('trippi://trips/{tripId}/collab-notes', { list: undefined }),
      { description: 'Shared collaborative notes for a trip', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const notes = await listCollabNotes(id);
        return jsonContent(uri.href, notes);
      },
    );

  // Trip to-do list
  if (packingEnabled && canRead(scopes, 'todos'))
    server.registerResource(
      'trip-todos',
      new ResourceTemplate('trippi://trips/{tripId}/todos', { list: undefined }),
      { description: 'To-do items for a trip, ordered by position', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const items = await listTodoItems(id);
        return jsonContent(uri.href, items);
      },
    );

  // All place categories (global, no trip filter) — safe for any authenticated session
  server.registerResource(
    'categories',
    'trippi://categories',
    {
      description: 'All available place categories (id, name, color, icon) for use when creating places',
      mimeType: 'application/json',
    },
    async (uri) => {
      const categories = await listCategoriesAsync();
      return jsonContent(uri.href, categories);
    },
  );

  // User's bucket list
  if (atlasEnabled && canRead(scopes, 'atlas'))
    server.registerResource(
      'bucket-list',
      'trippi://bucket-list',
      { description: 'Your personal travel bucket list', mimeType: 'application/json' },
      async (uri) => {
        const items = await listBucketList(userId);
        return jsonContent(uri.href, items);
      },
    );

  // User's visited countries
  if (atlasEnabled && canRead(scopes, 'atlas'))
    server.registerResource(
      'visited-countries',
      'trippi://visited-countries',
      { description: 'Countries you have marked as visited in Atlas', mimeType: 'application/json' },
      async (uri) => {
        const countries = await listVisitedCountries(userId);
        return jsonContent(uri.href, countries);
      },
    );

  // Budget per-person summary
  if (budgetEnabled && canRead(scopes, 'budget'))
    server.registerResource(
      'trip-budget-per-person',
      new ResourceTemplate('trippi://trips/{tripId}/budget/per-person', { list: undefined }),
      {
        description: 'Per-person budget summary for a trip (total spent per member, split breakdown)',
        mimeType: 'application/json',
      },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const summary = await getPerPersonSummary(id);
        return jsonContent(uri.href, summary);
      },
    );

  // Budget settlement
  if (budgetEnabled && canRead(scopes, 'budget'))
    server.registerResource(
      'trip-budget-settlement',
      new ResourceTemplate('trippi://trips/{tripId}/budget/settlement', { list: undefined }),
      { description: 'Suggested settlement transactions to balance who owes whom', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const settlement = await calculateSettlement(id);
        return jsonContent(uri.href, settlement);
      },
    );

  // Packing bags
  if (packingEnabled && canRead(scopes, 'packing'))
    server.registerResource(
      'trip-packing-bags',
      new ResourceTemplate('trippi://trips/{tripId}/packing/bags', { list: undefined }),
      { description: 'All packing bags for a trip with their members', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const bags = await listBags(id);
        return jsonContent(uri.href, bags);
      },
    );

  // In-app notifications
  if (canRead(scopes, 'notifications'))
    server.registerResource(
      'notifications-in-app',
      'trippi://notifications/in-app',
      {
        description: "The current user's in-app notifications (most recent 50, unread first)",
        mimeType: 'application/json',
      },
      async (uri) => {
        const result = await getNotificationsAsync(userId, { limit: 50 });
        return jsonContent(uri.href, result);
      },
    );

  // Atlas stats and regions (addon-gated)
  if (atlasEnabled && canRead(scopes, 'atlas')) {
    server.registerResource(
      'atlas-stats',
      'trippi://atlas/stats',
      { description: "User's atlas statistics — visited country counts and breakdown", mimeType: 'application/json' },
      async (uri) => {
        const stats = await getAtlasStats(userId);
        return jsonContent(uri.href, stats);
      },
    );

    server.registerResource(
      'atlas-regions',
      'trippi://atlas/regions',
      { description: 'List of manually visited regions for the current user', mimeType: 'application/json' },
      async (uri) => {
        const regions = await listManuallyVisitedRegions(userId);
        return jsonContent(uri.href, regions);
      },
    );
  }

  // Collab polls (addon + sub-feature gated)
  if (collabFeatures?.polls && canRead(scopes, 'collab')) {
    server.registerResource(
      'trip-collab-polls',
      new ResourceTemplate('trippi://trips/{tripId}/collab/polls', { list: undefined }),
      { description: 'All polls for a trip with vote counts per option', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const polls = await listPolls(id);
        return jsonContent(uri.href, polls);
      },
    );
  }

  // Collab messages (addon + sub-feature gated)
  if (collabFeatures?.chat && canRead(scopes, 'collab')) {
    server.registerResource(
      'trip-collab-messages',
      new ResourceTemplate('trippi://trips/{tripId}/collab/messages', { list: undefined }),
      { description: 'Most recent 100 chat messages for a trip', mimeType: 'application/json' },
      async (uri, { tripId }) => {
        const id = parseId(tripId);
        if (id === null || !(await canAccessTrip(id, userId))) return accessDenied(uri.href);
        const messages = await listMessages(id);
        return jsonContent(uri.href, messages);
      },
    );
  }

  // Vacay resources (addon-gated)
  if (vacayEnabled && canRead(scopes, 'vacay')) {
    server.registerResource(
      'vacay-plan',
      'trippi://vacay/plan',
      {
        description: "Full snapshot of the user's active vacation plan (members, years, settings)",
        mimeType: 'application/json',
      },
      async (uri) => {
        const plan = await getPlanData(userId);
        return jsonContent(uri.href, plan);
      },
    );

    server.registerResource(
      'vacay-entries',
      new ResourceTemplate('trippi://vacay/entries/{year}', { list: undefined }),
      { description: 'All vacation entries for the active plan and a specific year', mimeType: 'application/json' },
      async (uri, { year }) => {
        const planId = await getActivePlanId(userId);
        const entries = await getVacayEntries(planId, Array.isArray(year) ? year[0] : year);
        return jsonContent(uri.href, entries);
      },
    );

    server.registerResource(
      'vacay-holidays',
      new ResourceTemplate('trippi://vacay/holidays/{year}', { list: undefined }),
      { description: "Cached public holidays for the plan's configured region and year", mimeType: 'application/json' },
      async (uri, { year }) => {
        const plan = await getActivePlan(userId);
        if (!plan.holidays_enabled || !plan.holidays_region) return jsonContent(uri.href, []);
        const yearStr = Array.isArray(year) ? year[0] : year;
        const result = await getHolidays(yearStr, plan.holidays_region);
        return jsonContent(uri.href, result.data ?? []);
      },
    );
  }

  // Journey resources (Journey addon)
  if (journeyEnabled && canRead(scopes, 'journey')) {
    server.registerResource(
      'journeys',
      'trippi://journeys',
      { description: 'All journeys owned or contributed to by the current user', mimeType: 'application/json' },
      async (uri) => {
        const journeys = await listJourneys(userId);
        return jsonContent(uri.href, journeys);
      },
    );

    server.registerResource(
      'journey-detail',
      new ResourceTemplate('trippi://journeys/{journeyId}', { list: undefined }),
      { description: 'Single journey with entries, contributors, and trip links', mimeType: 'application/json' },
      async (uri, { journeyId }) => {
        const id = parseId(journeyId);
        if (id === null) return accessDenied(uri.href);
        const journey = await getJourneyFull(id, userId);
        if (!journey) return accessDenied(uri.href);
        return jsonContent(uri.href, journey);
      },
    );

    server.registerResource(
      'journey-entries',
      new ResourceTemplate('trippi://journeys/{journeyId}/entries', { list: undefined }),
      { description: 'All entries in a journey (date, text, mood, linked trip)', mimeType: 'application/json' },
      async (uri, { journeyId }) => {
        const id = parseId(journeyId);
        if (id === null) return accessDenied(uri.href);
        const j = await canAccessJourney(id, userId);
        if (!j) return accessDenied(uri.href);
        const entries = await listEntries(id, userId);
        return jsonContent(uri.href, entries);
      },
    );

    server.registerResource(
      'journey-contributors',
      new ResourceTemplate('trippi://journeys/{journeyId}/contributors', { list: undefined }),
      { description: 'Contributors (owners and collaborators) of a journey', mimeType: 'application/json' },
      async (uri, { journeyId }) => {
        const id = parseId(journeyId);
        if (id === null) return accessDenied(uri.href);
        const j = await getJourneyFull(id, userId);
        if (!j) return accessDenied(uri.href);
        return jsonContent(uri.href, (j as any).contributors ?? []);
      },
    );
  }
}
