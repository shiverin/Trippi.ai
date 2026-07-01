import { canAccessTripAsync as canAccessTrip, isOwnerAsync as isOwner } from '../../db/asyncDatabase';
import { isDemoUser } from '../../services/authService';
import { countMessagesAsync, listPollsAsync } from '../../services/collabService';
import {
  applyItineraryPlan,
  ItineraryImportError,
  MAX_ITINERARY_IMPORT_ACTIVITIES,
  MAX_ITINERARY_IMPORT_DAYS,
} from '../../services/itineraryImportService';
import { createOrUpdateShareLinkAsync, deleteShareLinkAsync, getShareLinkAsync } from '../../services/shareService';
import { listItems as listTodoItems } from '../../services/todoService';
import { exportTripPdf } from '../../services/tripPdfExportService';
import {
  listTripsAsync,
  createTrip,
  updateTrip,
  deleteTrip,
  getTripSummary,
  listMembersAsync as listTripMembers,
  getTripOwnerAsync,
  addMember as addTripMember,
  removeMember as removeTripMember,
  copyTripById,
  exportICS,
  NotFoundError,
  ValidationError,
} from '../../services/tripService';
import { getMcpFeatureFlags } from '../featureFlags';
import { APPLY_ITINERARY_PLAN_TOOL_DESCRIPTION } from '../itineraryPlanningQuality';
import { canRead, canReadTrips, canWrite, canDeleteTrips, canShareTrips } from '../scopes';
import {
  safeBroadcast,
  MAX_MCP_TRIP_DAYS,
  TOOL_ANNOTATIONS_READONLY,
  TOOL_ANNOTATIONS_WRITE,
  TOOL_ANNOTATIONS_DELETE,
  TOOL_ANNOTATIONS_NON_IDEMPOTENT,
  demoDenied,
  noAccess,
  ok,
  hasTripPermission,
  permissionDenied,
} from './_shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

import { z } from 'zod';

const ItineraryLocationSchema = z
  .object({
    name: z.string().min(1).max(200).optional().describe('Display name for this real-world place.'),
    query: z
      .string()
      .min(1)
      .max(300)
      .describe('Search query for backend geocoding. Include this even when provider IDs or coordinates are known.'),
    address: z.string().max(500).optional().describe('Known street address or area, if available.'),
    google_place_id: z.string().max(200).optional().describe('Google Places ID, if known.'),
    google_ftid: z.string().max(300).optional().describe('Google Maps feature ID, if known.'),
    osm_id: z.string().max(120).optional().describe('OpenStreetMap ID, such as node:123, way:123, or relation:123.'),
    lat: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe('Known latitude from a reliable source. Do not invent coordinates.'),
    lng: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe('Known longitude from a reliable source. Do not invent coordinates.'),
  })
  .strict();

const ItineraryActivitySchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(200)
      .describe('Specific, user-facing activity title. Prefer real places or concrete logistics over vague labels.'),
    description: z
      .string()
      .max(2000)
      .optional()
      .describe(
        'Rich activity detail: why this stop belongs here, what to do/order/notice, and how it fits the day. Avoid generic one-line filler.',
      ),
    category: z
      .enum(['attraction', 'restaurant', 'hotel', 'activity', 'transport', 'shopping', 'nature', 'other'])
      .optional()
      .describe('Use restaurant/hotel/transport/nature/shopping/etc. precisely so maps, filters, and PDFs read well.'),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .describe('Planned local start time in 24-hour HH:mm format. Include this for every scheduled itinerary item.'),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .describe('Planned local end time for fixed bookings, timed tickets, transport, or long blocks.'),
    duration_minutes: z
      .number()
      .positive()
      .optional()
      .describe('Realistic on-site or logistics duration, including buffers when appropriate.'),
    location: ItineraryLocationSchema,
    notes: z
      .string()
      .max(2000)
      .optional()
      .describe(
        'Practical notes: booking windows, ticket/passport requirements, crowd timing, weather, route tips, meeting points, or backup choices.',
      ),
    price: z.number().nonnegative().optional().describe('Estimated per-person cost when useful; use 0 for free items.'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .describe('Currency for price, usually the trip currency or local currency.'),
  })
  .strict();

const ItineraryAccommodationSchema = z
  .object({
    title: z.string().min(1).max(200),
    location: ItineraryLocationSchema,
    check_in: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    check_out: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .strict();

const ItineraryDaySchema = z
  .object({
    day_number: z.number().int().positive(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    title: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Theme for the day, e.g. "East Tokyo contrasts" or "Arrival, old lanes, and riverside dinner".'),
    city: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('Primary city or area for geocoding and route sanity. Include this for every day when possible.'),
    activities: z
      .array(ItineraryActivitySchema)
      .max(MAX_ITINERARY_IMPORT_ACTIVITIES)
      .describe(
        'Ordered scheduled items. Normal full sightseeing days should usually include 5-8 locatable activities; arrival/departure/transit/rest days may have fewer but should include the logistics that make the day realistic.',
      ),
    accommodation: ItineraryAccommodationSchema.optional(),
  })
  .strict();

const ItineraryTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('new_trip'),
      title: z.string().min(1).max(200),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('existing_trip'),
      tripId: z.number().int().positive(),
      mode: z.enum(['append', 'replace_imported']),
    })
    .strict(),
]);

export function registerTripTools(
  server: McpServer,
  userId: number,
  scopes: string[] | null,
  getDeprecationNotice: () => string | null = () => null,
): void {
  const R = canReadTrips(scopes);
  const W = canWrite(scopes, 'trips');
  const WP = canWrite(scopes, 'places');
  const D = canDeleteTrips(scopes);
  const S = canShareTrips(scopes);

  // --- TRIPS ---

  if (W)
    server.registerTool(
      'create_trip',
      {
        description: 'Create a new trip. Returns the created trip with its generated days.',
        inputSchema: {
          title: z.string().min(1).max(200).describe('Trip title'),
          description: z.string().max(2000).optional().describe('Trip description'),
          start_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe('Start date (YYYY-MM-DD)'),
          end_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe('End date (YYYY-MM-DD)'),
          currency: z.string().length(3).optional().describe('Currency code (e.g. EUR, USD)'),
        },
        annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
      },
      async ({ title, description, start_date, end_date, currency }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (start_date) {
          const d = new Date(start_date + 'T00:00:00Z');
          if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== start_date)
            return {
              content: [{ type: 'text' as const, text: 'start_date is not a valid calendar date.' }],
              isError: true,
            };
        }
        if (end_date) {
          const d = new Date(end_date + 'T00:00:00Z');
          if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== end_date)
            return {
              content: [{ type: 'text' as const, text: 'end_date is not a valid calendar date.' }],
              isError: true,
            };
        }
        if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
          return { content: [{ type: 'text' as const, text: 'End date must be after start date.' }], isError: true };
        }
        const { trip } = createTrip(userId, { title, description, start_date, end_date, currency }, MAX_MCP_TRIP_DAYS);
        return ok({ trip });
      },
    );

  if (W && WP)
    server.registerTool(
      'apply_itinerary_plan',
      {
        description: APPLY_ITINERARY_PLAN_TOOL_DESCRIPTION,
        inputSchema: {
          target: ItineraryTargetSchema.describe(
            'new_trip creates a trip; existing_trip appends or replaces only previous MCP-imported itinerary objects.',
          ),
          lang: z.string().max(16).optional().describe('Preferred language for geocoding/search results.'),
          destination_context: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe(
              'Destination region/country appended to geocoding queries, e.g. "Yunnan, China". Include this for accurate multi-city planning.',
            ),
          cover_place_query: z
            .string()
            .min(1)
            .max(300)
            .optional()
            .describe(
              'Preferred itinerary place for the PDF cover photo, e.g. "Jade Dragon Snow Mountain". Send a place query from the itinerary, not an image URL; Trippi resolves the place photo server-side.',
            ),
          exportPdf: z.boolean().optional().describe('When true, also generate the official Trippi PDF export.'),
          days: z
            .array(ItineraryDaySchema)
            .min(1)
            .max(MAX_ITINERARY_IMPORT_DAYS)
            .describe(
              'Full itinerary payload. Every activity must include a location query. Include day city and destination_context so the backend can geocode accurately. If reliable coordinates/provider IDs are already known, include them; otherwise do not invent lat/lng. Build dense, realistic days with times, durations, meals, transfers, rest buffers, descriptions, notes, and accommodations when relevant.',
            ),
        },
        annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
      },
      async ({ target, lang, destination_context, cover_place_query, exportPdf, days }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (target.kind === 'existing_trip') {
          if (!(await canAccessTrip(target.tripId, userId))) return noAccess();
          if (!(await hasTripPermission('day_edit', target.tripId, userId))) return permissionDenied();
          if (!(await hasTripPermission('place_edit', target.tripId, userId))) return permissionDenied();
        }

        try {
          const result = await applyItineraryPlan(userId, {
            target,
            lang,
            destination_context,
            cover_place_query,
            exportPdf,
            days,
          });
          const response = {
            success: result.success,
            tripId: result.tripId,
            trip: result.trip,
            batchId: result.batchId,
            counts: result.counts,
            warnings: result.warnings,
            pdf: result.pdf,
            pdfError: result.pdfError,
          };
          safeBroadcast(result.tripId, 'trip:updated', { trip: result.trip });
          safeBroadcast(result.tripId, 'itinerary:imported', {
            tripId: result.tripId,
            batchId: result.batchId,
            counts: result.counts,
          });
          return ok(response);
        } catch (err) {
          if (err instanceof ItineraryImportError) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: 'itinerary_import_failed', issues: err.issues }),
                },
              ],
              isError: true,
            };
          }
          const message = err instanceof Error ? err.message : 'Failed to apply itinerary plan.';
          return { content: [{ type: 'text' as const, text: message }], isError: true };
        }
      },
    );

  if (W)
    server.registerTool(
      'update_trip',
      {
        description: "Update an existing trip's details.",
        inputSchema: {
          tripId: z.number().int().positive(),
          title: z.string().min(1).max(200).optional(),
          description: z.string().max(2000).optional(),
          start_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          end_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          currency: z.string().length(3).optional(),
          is_archived: z.boolean().optional().describe('Archive (true) or unarchive (false) the trip'),
          cover_image: z.string().optional().describe('Cover image path, e.g. /uploads/covers/abc.jpg'),
        },
        annotations: TOOL_ANNOTATIONS_WRITE,
      },
      async ({ tripId, title, description, start_date, end_date, currency, is_archived, cover_image }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('trip_edit', tripId, userId))) return permissionDenied();
        if (start_date) {
          const d = new Date(start_date + 'T00:00:00Z');
          if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== start_date)
            return {
              content: [{ type: 'text' as const, text: 'start_date is not a valid calendar date.' }],
              isError: true,
            };
        }
        if (end_date) {
          const d = new Date(end_date + 'T00:00:00Z');
          if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== end_date)
            return {
              content: [{ type: 'text' as const, text: 'end_date is not a valid calendar date.' }],
              isError: true,
            };
        }
        const { updatedTrip } = updateTrip(
          tripId,
          userId,
          { title, description, start_date, end_date, currency, is_archived, cover_image },
          'user',
        );
        safeBroadcast(tripId, 'trip:updated', { trip: updatedTrip });
        return ok({ trip: updatedTrip });
      },
    );

  if (D)
    server.registerTool(
      'delete_trip',
      {
        description: 'Delete a trip. Only the trip owner can delete it.',
        inputSchema: {
          tripId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_DELETE,
      },
      async ({ tripId }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (!(await isOwner(tripId, userId))) return noAccess();
        deleteTrip(tripId, userId, 'user');
        return ok({ success: true, tripId });
      },
    );

  // list_trips and get_trip_summary are always registered regardless of OAuth scopes —
  // they are navigation tools that any MCP client needs to discover trip IDs.
  server.registerTool(
    'list_trips',
    {
      description:
        'List all trips the current user owns or is a member of. Use this for trip discovery before calling get_trip_summary.',
      inputSchema: {
        include_archived: z.boolean().optional().describe('Include archived trips (default false)'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ include_archived }) => {
      const notice = getDeprecationNotice();
      const trips = await listTripsAsync(userId, include_archived ? null : 0);
      if (notice)
        return {
          isError: true as const,
          content: [
            { type: 'text' as const, text: notice },
            { type: 'text' as const, text: JSON.stringify({ trips }) },
          ],
        };
      return ok({ trips });
    },
  );

  // --- TRIP SUMMARY ---

  server.registerTool(
    'get_trip_summary',
    {
      description:
        'Get a full denormalized summary of a trip in a single call: metadata, members, days with assignments and notes, accommodations, budget line items (when enabled), packing list (when enabled), reservations, collab notes and poll/message counts (when enabled), and to-do items (when enabled). Use this as a context loader before planning or modifying a trip.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!(await canAccessTrip(tripId, userId))) return noAccess();
      // Addon availability gates
      const featureFlags = await getMcpFeatureFlags();
      const packingEnabled = featureFlags.packing;
      const budgetEnabled = featureFlags.budget;
      const collabEnabled = featureFlags.collab;
      const collabFeatures = featureFlags.collabFeatures;
      // Scope gates — sections not covered by the client's OAuth scopes are omitted.
      // Core trip data (metadata, days, members, accommodations) is always included
      // because this tool is always registered and needed for navigation.
      const canReadBudget = budgetEnabled && canRead(scopes, 'budget');
      const canReadPacking = packingEnabled && canRead(scopes, 'packing');
      const canReadCollab = collabEnabled && canRead(scopes, 'collab');
      const canReadTodos = packingEnabled && canRead(scopes, 'todos');
      const canReadRes = canRead(scopes, 'reservations');
      const summaryPromise = getTripSummary(tripId, {
        includeBudget: canReadBudget,
        includePacking: canReadPacking,
        includeReservations: canReadRes,
        includeCollabNotes: canReadCollab && Boolean(collabFeatures?.notes),
      });
      const todosPromise = canReadTodos ? listTodoItems(tripId) : Promise.resolve([]);
      const pollCountPromise =
        canReadCollab && collabFeatures?.polls
          ? listPollsAsync(tripId).then((polls) => polls.length)
          : Promise.resolve(0);
      const messageCountPromise =
        canReadCollab && collabFeatures?.chat ? countMessagesAsync(tripId) : Promise.resolve(0);
      const [summary, todos, pollCount, messageCount] = await Promise.all([
        summaryPromise,
        todosPromise,
        pollCountPromise,
        messageCountPromise,
      ]);
      if (!summary) return noAccess();
      const notice = getDeprecationNotice();
      const summaryData = {
        ...summary,
        reservations: canReadRes ? summary.reservations : undefined,
        packing: canReadPacking ? summary.packing : undefined,
        budget: canReadBudget ? summary.budget : undefined,
        collab_notes: canReadCollab && collabFeatures?.notes ? summary.collab_notes : [],
        todos,
        pollCount,
        messageCount,
      };
      if (notice)
        return {
          isError: true as const,
          content: [
            { type: 'text' as const, text: notice },
            { type: 'text' as const, text: JSON.stringify(summaryData) },
          ],
        };
      return ok(summaryData);
    },
  );

  // --- TRIP MEMBERS, COPY, EXPORTS, SHARE ---

  if (R)
    server.registerTool(
      'list_trip_members',
      {
        description: 'List all members of a trip (owner + collaborators).',
        inputSchema: {
          tripId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        const ownerRow = await getTripOwnerAsync(tripId);
        if (!ownerRow) return noAccess();
        const { owner, members } = await listTripMembers(tripId, ownerRow.user_id);
        return ok({ owner, members });
      },
    );

  if (W)
    server.registerTool(
      'add_trip_member',
      {
        description: 'Add a user to a trip by their username or email address. Only the trip owner can do this.',
        inputSchema: {
          tripId: z.number().int().positive(),
          identifier: z.string().min(1).describe('Username or email of the user to add'),
        },
        annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
      },
      async ({ tripId, identifier }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        const ownerRow = await getTripOwnerAsync(tripId);
        if (!ownerRow || ownerRow.user_id !== userId)
          return { content: [{ type: 'text' as const, text: 'Only the trip owner can add members.' }], isError: true };
        try {
          const result = addTripMember(tripId, identifier, ownerRow.user_id, userId);
          safeBroadcast(tripId, 'member:added', { member: result.member });
          return ok({ member: result.member });
        } catch (err) {
          const msg =
            err instanceof ValidationError || err instanceof NotFoundError ? err.message : 'Failed to add member.';
          return { content: [{ type: 'text' as const, text: msg }], isError: true };
        }
      },
    );

  if (W)
    server.registerTool(
      'remove_trip_member',
      {
        description: 'Remove a member from a trip. Only the trip owner can do this.',
        inputSchema: {
          tripId: z.number().int().positive(),
          memberId: z.number().int().positive().describe('User ID of the member to remove'),
        },
        annotations: TOOL_ANNOTATIONS_DELETE,
      },
      async ({ tripId, memberId }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        const ownerRow = await getTripOwnerAsync(tripId);
        if (!ownerRow || ownerRow.user_id !== userId)
          return {
            content: [{ type: 'text' as const, text: 'Only the trip owner can remove members.' }],
            isError: true,
          };
        removeTripMember(tripId, memberId);
        safeBroadcast(tripId, 'member:removed', { userId: memberId });
        return ok({ success: true });
      },
    );

  if (W)
    server.registerTool(
      'copy_trip',
      {
        description:
          'Duplicate a trip (all days, places, itinerary, packing, budget, reservations, day notes). Packing items are reset to unchecked. Returns the new trip.',
        inputSchema: {
          tripId: z.number().int().positive().describe('Source trip ID to duplicate'),
          title: z.string().min(1).max(200).optional().describe('Title for the new trip (defaults to source title)'),
        },
        annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
      },
      async ({ tripId, title }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        try {
          const newTripId = copyTripById(tripId, userId, title);
          const newTrip = await canAccessTrip(newTripId, userId);
          return ok({ trip: { id: newTripId, ...newTrip } });
        } catch {
          return { content: [{ type: 'text' as const, text: 'Failed to copy trip.' }], isError: true };
        }
      },
    );

  if (R)
    server.registerTool(
      'export_trip_ics',
      {
        description:
          "Export a trip's itinerary and reservations as iCalendar (.ics) format text. Useful for importing into calendar apps.",
        inputSchema: {
          tripId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        try {
          const { ics, filename } = await exportICS(tripId);
          return ok({ ics, filename });
        } catch {
          return { content: [{ type: 'text' as const, text: 'Trip not found.' }], isError: true };
        }
      },
    );

  if (R)
    server.registerTool(
      'export_trip_pdf',
      {
        description:
          "Export an existing trip's full itinerary as a downloadable PDF file generated by trippi.ai. Use this to retry PDF export or export an already-created trip; for new full-trip planning with a PDF, prefer apply_itinerary_plan with exportPdf: true. Returns a public unguessable download URL and filename.",
        inputSchema: {
          tripId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        try {
          const result = await exportTripPdf(tripId);
          return ok({ ...result, contentType: 'application/pdf' });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'PDF export failed.';
          return { content: [{ type: 'text' as const, text: message }], isError: true };
        }
      },
    );

  if (S)
    server.registerTool(
      'get_share_link',
      {
        description:
          'Get the current public share link for a trip, including its permission flags. Returns null if no share link exists.',
        inputSchema: {
          tripId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId }) => {
        // Read parity with the REST route GET /api/trips/:tripId/share-link, which
        // only requires trip membership (share_manage gates create/delete, not read).
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        const link = await getShareLinkAsync(String(tripId));
        return ok({ link });
      },
    );

  if (S)
    server.registerTool(
      'create_share_link',
      {
        description:
          'Create or update the public share link for a trip. Set permission flags to control what is visible to guests.',
        inputSchema: {
          tripId: z.number().int().positive(),
          share_map: z.boolean().optional().default(true).describe('Share the map and places'),
          share_bookings: z.boolean().optional().default(true).describe('Share reservations'),
          share_packing: z.boolean().optional().default(false).describe('Share packing list'),
          share_budget: z.boolean().optional().default(false).describe('Share budget'),
          share_collab: z.boolean().optional().default(false).describe('Share collab messages'),
        },
        annotations: TOOL_ANNOTATIONS_WRITE,
      },
      async ({ tripId, share_map, share_bookings, share_packing, share_budget, share_collab }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('share_manage', tripId, userId))) return permissionDenied();
        const { token, created } = await createOrUpdateShareLinkAsync(String(tripId), userId, {
          share_map: share_map ?? true,
          share_bookings: share_bookings ?? true,
          share_packing: share_packing ?? false,
          share_budget: share_budget ?? false,
          share_collab: share_collab ?? false,
        });
        return ok({ token, created });
      },
    );

  if (S)
    server.registerTool(
      'delete_share_link',
      {
        description:
          'Revoke the public share link for a trip. Guests will no longer be able to access the shared view.',
        inputSchema: {
          tripId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_DELETE,
      },
      async ({ tripId }) => {
        if (isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('share_manage', tripId, userId))) return permissionDenied();
        await deleteShareLinkAsync(String(tripId));
        return ok({ success: true });
      },
    );
}
