import { asyncDb, canAccessTripAsync as canAccessTrip } from '../../db/asyncDatabase';
import {
  BookingIntentValidationError,
  BookingIntentsService,
  type BookingIntentInput,
} from '../../nest/booking-intents/booking-intents.service';
import {
  BookingOptionValidationError,
  BookingOptionsService,
} from '../../nest/booking-options/booking-options.service';
import { isDemoEmail } from '../../services/demo';
import { canRead, canWrite } from '../scopes';
import {
  TOOL_ANNOTATIONS_NON_IDEMPOTENT,
  TOOL_ANNOTATIONS_READONLY,
  TOOL_ANNOTATIONS_WRITE,
  demoDenied,
  hasTripPermission,
  noAccess,
  ok,
  permissionDenied,
  safeBroadcast,
} from './_shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

import { z } from 'zod';

type BookingIntentStatus =
  | 'draft'
  | 'watching'
  | 'options_ready'
  | 'voting'
  | 'approved'
  | 'pending_checkout'
  | 'booked'
  | 'archived';
type BookingIntentWatchStatus = 'idle' | 'queued' | 'checking' | 'checked' | 'failed';
type BookingOptionStatus = 'all' | 'current' | 'expired' | 'archived';

interface BookingIntentRecord {
  id: number;
  trip_id: number;
  created_by: number | null;
  type: string;
  dates: Record<string, unknown>;
  origin: string | null;
  destination: string | null;
  party_constraints: Record<string, unknown>;
  budget: Record<string, unknown>;
  preferences: Record<string, unknown>;
  status: BookingIntentStatus;
  watch_status: BookingIntentWatchStatus;
  last_checked_at: string | null;
  checkout_option_id: number | null;
  checkout_provider: string | null;
  checkout_url: string | null;
  checkout_started_at: string | null;
  booked_at: string | null;
  reservation_id: number | null;
  reservation_url: string | null;
  confirmation_number: string | null;
  created_at: string;
  updated_at: string;
}

interface BookingOptionRecord {
  id: number;
  booking_intent_id: number;
  provider: string;
  external_id: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  score: number | null;
  expires_at: string | null;
  checkout_url: string | null;
  metadata: Record<string, unknown>;
  status: 'current' | 'expired' | 'archived';
  is_expired: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

const bookingIntents = new BookingIntentsService();
const bookingOptions = new BookingOptionsService();

const JsonObjectSchema = z.object({}).passthrough();
const IntentStatusSchema = z.enum([
  'draft',
  'watching',
  'options_ready',
  'voting',
  'approved',
  'pending_checkout',
  'booked',
  'archived',
]);
const MutableIntentStatusSchema = z.enum(['draft', 'watching', 'options_ready', 'voting', 'approved', 'archived']);

async function isDemoUser(userId: number): Promise<boolean> {
  if (process.env.DEMO_MODE !== 'true') return false;
  const user = await asyncDb.prepare('SELECT email FROM users WHERE id = ?').get<{ email: string }>(userId);
  return isDemoEmail(user?.email);
}

function toolError(err: unknown, fallback: string) {
  const message =
    err instanceof BookingIntentValidationError || err instanceof BookingOptionValidationError || err instanceof Error
      ? err.message
      : fallback;
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function formatRoute(intent: BookingIntentRecord): string {
  if (intent.origin && intent.destination) return `${intent.origin} to ${intent.destination}`;
  return intent.destination ?? intent.origin ?? 'destination TBD';
}

function intentNextStep(intent: BookingIntentRecord): string {
  if (intent.status === 'draft') return 'Ready for more details or a price watch.';
  if (intent.status === 'watching' && intent.watch_status === 'queued') return 'Price watch is queued.';
  if (intent.status === 'watching' && intent.watch_status === 'checking') return 'Price watch is checking providers.';
  if (intent.status === 'watching') return 'Review watch results when options are ready.';
  if (intent.status === 'options_ready') return 'Review ranked booking options or create a group decision.';
  if (intent.status === 'voting') return 'Waiting for the linked group decision.';
  if (intent.status === 'approved') return 'Prepare a checkout handoff for the approved provider option.';
  if (intent.status === 'pending_checkout') return 'Checkout handoff is prepared; finish purchase with the provider.';
  if (intent.status === 'booked') return 'Already marked booked outside these MCP booking tools.';
  return 'Archived.';
}

function summarizeIntent(intent: BookingIntentRecord): Record<string, unknown> {
  const checkout =
    intent.checkout_option_id || intent.checkout_provider || intent.checkout_url || intent.checkout_started_at
      ? {
          option_id: intent.checkout_option_id,
          provider: intent.checkout_provider,
          checkout_url: intent.checkout_url,
          started_at: intent.checkout_started_at,
        }
      : null;
  const booked =
    intent.booked_at || intent.reservation_id || intent.reservation_url || intent.confirmation_number
      ? {
          booked_at: intent.booked_at,
          reservation_id: intent.reservation_id,
          reservation_url: intent.reservation_url,
          confirmation_number: intent.confirmation_number,
        }
      : null;

  return {
    id: intent.id,
    trip_id: intent.trip_id,
    type: intent.type,
    route: {
      origin: intent.origin,
      destination: intent.destination,
      label: formatRoute(intent),
    },
    dates: intent.dates,
    party_constraints: intent.party_constraints,
    budget: intent.budget,
    preferences: intent.preferences,
    status: intent.status,
    watch_status: intent.watch_status,
    last_checked_at: intent.last_checked_at,
    checkout,
    booked,
    summary: `${intent.type} booking intent ${intent.id} for ${formatRoute(intent)} is ${intent.status}.`,
    next_step: intentNextStep(intent),
    created_by: intent.created_by,
    created_at: intent.created_at,
    updated_at: intent.updated_at,
  };
}

function formatPrice(option: BookingOptionRecord): string {
  if (option.price == null) return 'price unavailable';
  return option.currency ? `${option.currency} ${option.price}` : String(option.price);
}

function summarizeOption(option: BookingOptionRecord, rank: number): Record<string, unknown> {
  const title = option.title ?? `${option.provider} option ${option.id}`;
  const availability = option.status === 'current' && !option.is_expired ? 'current' : option.status;
  const handoff =
    option.checkout_url && availability === 'current' ? 'checkout handoff available' : 'no active handoff link';

  return {
    rank,
    id: option.id,
    booking_intent_id: option.booking_intent_id,
    provider: option.provider,
    external_id: option.external_id,
    title: option.title,
    price: option.price,
    currency: option.currency,
    score: option.score,
    status: option.status,
    is_expired: option.is_expired,
    expires_at: option.expires_at,
    checkout_url: option.checkout_url,
    has_checkout_handoff: Boolean(option.checkout_url && availability === 'current'),
    metadata: option.metadata,
    summary: `#${rank}: ${title} from ${option.provider}, ${formatPrice(option)}, score ${
      option.score ?? 'unscored'
    }, ${handoff}.`,
    created_at: option.created_at,
    updated_at: option.updated_at,
    archived_at: option.archived_at,
  };
}

function compactJob(job: { id: number; status: string; next_run_at: string; provider: string | null }) {
  return {
    id: job.id,
    status: job.status,
    next_run_at: job.next_run_at,
    provider: job.provider,
    summary: `Price-watch job ${job.id} is ${job.status}.`,
  };
}

function bookingIntentInput(input: {
  type?: string;
  dates?: Record<string, unknown>;
  origin?: string | null;
  destination?: string | null;
  party_constraints?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  status?: string;
}): BookingIntentInput {
  const data: BookingIntentInput = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.dates !== undefined) data.dates = input.dates;
  if (input.origin !== undefined) data.origin = input.origin;
  if (input.destination !== undefined) data.destination = input.destination;
  if (input.party_constraints !== undefined) data.party_constraints = input.party_constraints;
  if (input.budget !== undefined) data.budget = input.budget;
  if (input.preferences !== undefined) data.preferences = input.preferences;
  if (input.status !== undefined) data.status = input.status;
  return data;
}

export function registerBookingIntentTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const R = canRead(scopes, 'reservations');
  const W = canWrite(scopes, 'reservations');

  if (W)
    server.registerTool(
      'create_booking_intent',
      {
        description:
          'Create a booking intent for a trip, such as a flight or hotel search brief. This records intent only; Trippi does not purchase travel or store payment cards.',
        inputSchema: {
          tripId: z.number().int().positive(),
          type: z.string().min(1).max(64).describe('Booking category, for example flight, hotel, train, or car.'),
          dates: JsonObjectSchema.optional().describe('Structured date constraints for the booking search.'),
          origin: z.string().max(500).nullable().optional(),
          destination: z.string().max(500).nullable().optional(),
          party_constraints: JsonObjectSchema.optional().describe(
            'Traveler count, bags, accessibility, or other party needs.',
          ),
          budget: JsonObjectSchema.optional().describe(
            'Structured budget constraints such as max amount and currency.',
          ),
          preferences: JsonObjectSchema.optional().describe(
            'Structured search preferences such as refundable or nonstop.',
          ),
          status: z
            .enum(['draft', 'watching', 'options_ready', 'voting', 'approved'])
            .optional()
            .describe('Initial planning status. Cannot create booked or pending-checkout intents through MCP.'),
        },
        annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
      },
      async ({ tripId, type, dates, origin, destination, party_constraints, budget, preferences, status }) => {
        if (await isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('reservation_edit', tripId, userId))) return permissionDenied();

        try {
          const bookingIntent = (await bookingIntents.create(
            String(tripId),
            userId,
            bookingIntentInput({ type, dates, origin, destination, party_constraints, budget, preferences, status }),
          )) as BookingIntentRecord | null;
          if (!bookingIntent)
            return { content: [{ type: 'text' as const, text: 'Booking intent was not created.' }], isError: true };
          safeBroadcast(tripId, 'booking-intent:created', { booking_intent: bookingIntent });
          return ok({ booking_intent: summarizeIntent(bookingIntent) });
        } catch (err) {
          return toolError(err, 'Failed to create booking intent.');
        }
      },
    );

  if (R)
    server.registerTool(
      'list_booking_intents',
      {
        description:
          'List booking intents for a trip, including watch state, checkout handoff state, and next-step summaries.',
        inputSchema: {
          tripId: z.number().int().positive(),
          status: IntentStatusSchema.optional().describe('Optional status filter.'),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId, status }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        try {
          const intents = (await bookingIntents.list(String(tripId), status)) as BookingIntentRecord[];
          return ok({
            tripId,
            count: intents.length,
            booking_intents: intents.map(summarizeIntent),
          });
        } catch (err) {
          return toolError(err, 'Failed to list booking intents.');
        }
      },
    );

  if (W)
    server.registerTool(
      'update_booking_intent',
      {
        description:
          'Update a booking intent search brief or planning status. This cannot mark a trip as booked or collect payment; use checkout handoff for approved provider options.',
        inputSchema: {
          tripId: z.number().int().positive(),
          bookingIntentId: z.number().int().positive(),
          type: z.string().min(1).max(64).optional(),
          dates: JsonObjectSchema.optional(),
          origin: z.string().max(500).nullable().optional(),
          destination: z.string().max(500).nullable().optional(),
          party_constraints: JsonObjectSchema.optional(),
          budget: JsonObjectSchema.optional(),
          preferences: JsonObjectSchema.optional(),
          status: MutableIntentStatusSchema.optional().describe('Cannot be pending_checkout or booked through MCP.'),
          confirm_archive: z.boolean().optional().default(false).describe('Required when setting status to archived.'),
        },
        annotations: TOOL_ANNOTATIONS_WRITE,
      },
      async ({
        tripId,
        bookingIntentId,
        type,
        dates,
        origin,
        destination,
        party_constraints,
        budget,
        preferences,
        status,
        confirm_archive,
      }) => {
        if (await isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('reservation_edit', tripId, userId))) return permissionDenied();
        if (status === 'archived' && !confirm_archive) {
          return {
            content: [{ type: 'text' as const, text: 'Set confirm_archive=true to archive a booking intent.' }],
            isError: true,
          };
        }

        try {
          const bookingIntent = (await bookingIntents.update(
            String(tripId),
            String(bookingIntentId),
            bookingIntentInput({ type, dates, origin, destination, party_constraints, budget, preferences, status }),
          )) as BookingIntentRecord | null;
          if (!bookingIntent)
            return { content: [{ type: 'text' as const, text: 'Booking intent not found.' }], isError: true };
          const event = status === 'archived' ? 'booking-intent:archived' : 'booking-intent:updated';
          safeBroadcast(tripId, event, { booking_intent: bookingIntent });
          return ok({ booking_intent: summarizeIntent(bookingIntent) });
        } catch (err) {
          return toolError(err, 'Failed to update booking intent.');
        }
      },
    );

  if (W)
    server.registerTool(
      'start_booking_price_watch',
      {
        description:
          'Start or requeue a price watch for a booking intent. This searches provider options asynchronously and never purchases travel.',
        inputSchema: {
          tripId: z.number().int().positive(),
          bookingIntentId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_WRITE,
      },
      async ({ tripId, bookingIntentId }) => {
        if (await isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('reservation_edit', tripId, userId))) return permissionDenied();

        try {
          const result = await bookingIntents.startWatch(String(tripId), String(bookingIntentId));
          if (!result)
            return { content: [{ type: 'text' as const, text: 'Booking intent not found.' }], isError: true };
          const bookingIntent = result.bookingIntent as BookingIntentRecord;
          safeBroadcast(tripId, 'booking-intent:watch-started', {
            booking_intent: bookingIntent,
            agent_job: result.agentJob,
          });
          return ok({
            booking_intent: summarizeIntent(bookingIntent),
            agent_job: compactJob(result.agentJob),
            summary: 'Price watch queued. Check back later with list_ranked_booking_options.',
          });
        } catch (err) {
          return toolError(err, 'Failed to start booking price watch.');
        }
      },
    );

  if (R)
    server.registerTool(
      'list_ranked_booking_options',
      {
        description:
          'List booking options for an intent in ranked order: score descending, then lower price. This is read-only and does not reserve or buy anything.',
        inputSchema: {
          tripId: z.number().int().positive(),
          bookingIntentId: z.number().int().positive(),
          status: z
            .enum(['all', 'current', 'expired', 'archived'])
            .optional()
            .describe('Defaults to current plus expired, excluding archived.'),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId, bookingIntentId, status }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        try {
          const options = (await bookingOptions.list(
            String(tripId),
            String(bookingIntentId),
            status as BookingOptionStatus | undefined,
          )) as BookingOptionRecord[] | null;
          if (!options)
            return { content: [{ type: 'text' as const, text: 'Booking intent not found.' }], isError: true };
          const ranked = options.map((option, index) => summarizeOption(option, index + 1));
          return ok({
            tripId,
            booking_intent_id: bookingIntentId,
            count: ranked.length,
            best_option: ranked[0] ?? null,
            booking_options: ranked,
          });
        } catch (err) {
          return toolError(err, 'Failed to list booking options.');
        }
      },
    );

  if (W)
    server.registerTool(
      'prepare_booking_checkout_handoff',
      {
        description:
          'Prepare a provider checkout handoff URL for an approved booking option. This only hands the user to the provider; Trippi does not purchase travel, charge cards, or store payment card details.',
        inputSchema: {
          tripId: z.number().int().positive(),
          bookingIntentId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
      },
      async ({ tripId, bookingIntentId }) => {
        if (await isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('reservation_edit', tripId, userId))) return permissionDenied();

        try {
          const result = await bookingIntents.prepareCheckoutHandoff(String(tripId), String(bookingIntentId));
          if (!result)
            return { content: [{ type: 'text' as const, text: 'Booking intent not found.' }], isError: true };
          const bookingIntent = result.bookingIntent as BookingIntentRecord;
          safeBroadcast(tripId, 'booking-intent:checkout-started', {
            booking_intent: bookingIntent,
            handoff: result.handoff,
          });
          return ok({
            booking_intent: summarizeIntent(bookingIntent),
            handoff: {
              ...result.handoff,
              summary:
                'Open this provider checkout URL to complete the purchase outside Trippi. This MCP tool did not book or charge anything.',
            },
          });
        } catch (err) {
          return toolError(err, 'Failed to prepare booking checkout handoff.');
        }
      },
    );
}
