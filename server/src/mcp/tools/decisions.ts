import { asyncDb, canAccessTripAsync as canAccessTrip } from '../../db/asyncDatabase';
import { DecisionsService, GroupDecisionInputError } from '../../nest/decisions/decisions.service';
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

type DecisionState = 'open' | 'closed' | 'decided' | 'cancelled';
type ResponseState = 'selected' | 'maybe' | 'declined' | 'abstain';

interface DecisionOption {
  id: number;
  label: string;
  description: string | null;
  sort_order: number;
}

interface DecisionResponse {
  user_id: number;
  username: string;
  option_id: number | null;
  response: ResponseState;
  comment: string | null;
}

interface DecisionRecord {
  id: number;
  trip_id: number;
  created_by: number;
  created_by_username?: string;
  title: string;
  description: string | null;
  deadline: string | null;
  state: DecisionState;
  final_option_id: number | null;
  final_option: DecisionOption | null;
  options: DecisionOption[];
  responses: DecisionResponse[];
  links: Array<{ target_type: string; target_id: number }>;
  created_at: string;
  updated_at: string;
}

const decisions = new DecisionsService();
const UNRESOLVED_STATES = new Set<DecisionState>(['open', 'closed']);

const DecisionOptionInputSchema = z.union([
  z.string().min(1).max(200),
  z
    .object({
      label: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      sort_order: z.number().int().min(0).optional(),
    })
    .strict(),
]);

const DecisionLinkInputSchema = z
  .object({
    target_type: z
      .enum(['trip', 'day', 'place', 'reservation', 'booking_intent', 'packing_item'])
      .describe('Type of trip object the decision is about.'),
    target_id: z.number().int().positive().describe('ID of the linked trip object.'),
  })
  .strict();

async function isDemoUser(userId: number): Promise<boolean> {
  if (process.env.DEMO_MODE !== 'true') return false;
  const user = await asyncDb.prepare('SELECT email FROM users WHERE id = ?').get<{ email: string }>(userId);
  return isDemoEmail(user?.email);
}

function toolError(err: unknown, fallback: string) {
  const message = err instanceof GroupDecisionInputError ? err.message : err instanceof Error ? err.message : fallback;
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

async function countTripParticipants(tripId: number | string): Promise<number> {
  const row = await asyncDb
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM (
        SELECT user_id FROM trips WHERE id = ?
        UNION
        SELECT user_id FROM trip_members WHERE trip_id = ?
      )
    `,
    )
    .get<{ count: number }>(tripId, tripId);
  return row?.count ?? 0;
}

function nextStep(decision: DecisionRecord, pendingResponseCount: number): string {
  if (decision.state === 'open' && pendingResponseCount > 0) {
    return `Waiting for ${pendingResponseCount} member response${pendingResponseCount === 1 ? '' : 's'}.`;
  }
  if (decision.state === 'open') return 'Ready to close or finalize.';
  if (decision.state === 'closed') return 'Vote is closed; choose a final option.';
  if (decision.state === 'decided') return 'Finalized.';
  return 'Cancelled.';
}

function summarizeDecision(
  decision: DecisionRecord,
  participantCount: number,
  includeResponses = false,
): Record<string, unknown> {
  const optionLabels = new Map(decision.options.map((option) => [option.id, option.label]));
  const responseUserIds = new Set<number>();
  const responsesByState: Record<ResponseState, number> = { selected: 0, maybe: 0, declined: 0, abstain: 0 };
  const optionCounts = new Map(
    decision.options.map((option) => [
      option.id,
      { selected: 0, maybe: 0, declined: 0, abstain: 0 } as Record<ResponseState, number>,
    ]),
  );

  for (const response of decision.responses) {
    responseUserIds.add(response.user_id);
    responsesByState[response.response] += 1;
    if (response.option_id != null) {
      const counts = optionCounts.get(response.option_id);
      if (counts) counts[response.response] += 1;
    }
  }

  const pendingResponseCount = decision.state === 'open' ? Math.max(participantCount - responseUserIds.size, 0) : 0;

  return {
    id: decision.id,
    trip_id: decision.trip_id,
    title: decision.title,
    description: decision.description,
    state: decision.state,
    unresolved: UNRESOLVED_STATES.has(decision.state),
    deadline: decision.deadline,
    final_option: decision.final_option ? { id: decision.final_option.id, label: decision.final_option.label } : null,
    response_count: responseUserIds.size,
    pending_response_count: pendingResponseCount,
    participant_count: participantCount,
    responses_by_state: responsesByState,
    next_step: nextStep(decision, pendingResponseCount),
    options: decision.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      counts: optionCounts.get(option.id),
    })),
    links: decision.links.map((link) => ({ target_type: link.target_type, target_id: link.target_id })),
    responses: includeResponses
      ? decision.responses.map((response) => ({
          user_id: response.user_id,
          username: response.username,
          response: response.response,
          option_id: response.option_id,
          option_label: response.option_id != null ? (optionLabels.get(response.option_id) ?? null) : null,
          comment: response.comment,
        }))
      : undefined,
    created_by: decision.created_by,
    created_by_username: decision.created_by_username,
    updated_at: decision.updated_at,
  };
}

async function summarizeForTrip(
  tripId: number,
  decision: DecisionRecord,
  includeResponses = false,
): Promise<Record<string, unknown>> {
  const participantCount = await countTripParticipants(tripId);
  return summarizeDecision(decision, participantCount, includeResponses);
}

export function registerDecisionTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const R = canRead(scopes, 'collab');
  const W = canWrite(scopes, 'collab');

  if (W)
    server.registerTool(
      'create_group_decision',
      {
        description:
          'Create a group decision for a trip, optionally linked to trip objects such as days, places, reservations, booking intents, or packing items.',
        inputSchema: {
          tripId: z.number().int().positive(),
          title: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          deadline: z.string().max(100).optional().describe('Optional ISO date/time deadline.'),
          options: z.array(DecisionOptionInputSchema).min(2).describe('At least two decision options.'),
          links: z
            .array(DecisionLinkInputSchema)
            .optional()
            .describe('Trip objects this decision is about. IDs must belong to the trip.'),
        },
        annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
      },
      async ({ tripId, title, description, deadline, options, links }) => {
        if (await isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('trip_edit', tripId, userId))) return permissionDenied();

        try {
          const decision = (await decisions.create(String(tripId), userId, {
            title,
            description,
            deadline,
            options,
            links,
          })) as DecisionRecord | null;
          if (!decision)
            return { content: [{ type: 'text' as const, text: 'Decision was not created.' }], isError: true };
          safeBroadcast(tripId, 'decision:created', { decision });
          return ok({ decision: await summarizeForTrip(tripId, decision, false) });
        } catch (err) {
          return toolError(err, 'Failed to create decision.');
        }
      },
    );

  if (R)
    server.registerTool(
      'list_group_decisions',
      {
        description:
          'List group decision summaries for a trip, including vote counts and next steps. Use unresolved_only to find open blockers.',
        inputSchema: {
          tripId: z.number().int().positive(),
          state: z.enum(['open', 'closed', 'decided', 'cancelled']).optional(),
          unresolved_only: z.boolean().optional().default(false),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId, state, unresolved_only }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        const allDecisions = ((await decisions.list(String(tripId))) as DecisionRecord[]).filter((decision) => {
          if (state && decision.state !== state) return false;
          return !unresolved_only || UNRESOLVED_STATES.has(decision.state);
        });
        const participantCount = await countTripParticipants(tripId);
        const summaries = allDecisions.map((decision) => summarizeDecision(decision, participantCount, false));
        const unresolvedCount = summaries.filter((decision) => decision.unresolved).length;
        return ok({
          tripId,
          count: summaries.length,
          unresolved_count: unresolvedCount,
          decisions: summaries,
        });
      },
    );

  if (R)
    server.registerTool(
      'list_unresolved_group_decisions',
      {
        description:
          'List unresolved group decisions for a trip: open votes still waiting for responses and closed votes awaiting a final option.',
        inputSchema: {
          tripId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        const allDecisions = (await decisions.list(String(tripId))) as DecisionRecord[];
        const unresolved = allDecisions.filter((decision) => UNRESOLVED_STATES.has(decision.state));
        const participantCount = await countTripParticipants(tripId);
        return ok({
          tripId,
          unresolved_count: unresolved.length,
          decisions: unresolved.map((decision) => summarizeDecision(decision, participantCount, false)),
        });
      },
    );

  if (R)
    server.registerTool(
      'get_group_decision_status',
      {
        description:
          'Read one group decision with option vote counts, individual responses, linked trip objects, and next-step status.',
        inputSchema: {
          tripId: z.number().int().positive(),
          decisionId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_READONLY,
      },
      async ({ tripId, decisionId }) => {
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        const decision = (await decisions.get(String(tripId), decisionId)) as DecisionRecord | null;
        if (!decision) return { content: [{ type: 'text' as const, text: 'Decision not found.' }], isError: true };
        return ok({ decision: await summarizeForTrip(tripId, decision, true) });
      },
    );

  if (W)
    server.registerTool(
      'close_group_decision',
      {
        description:
          'Close an open group decision so no more responses are expected. This does not choose a final option.',
        inputSchema: {
          tripId: z.number().int().positive(),
          decisionId: z.number().int().positive(),
        },
        annotations: TOOL_ANNOTATIONS_WRITE,
      },
      async ({ tripId, decisionId }) => {
        if (await isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('trip_edit', tripId, userId))) return permissionDenied();

        try {
          const current = (await decisions.get(String(tripId), decisionId)) as DecisionRecord | null;
          if (!current) return { content: [{ type: 'text' as const, text: 'Decision not found.' }], isError: true };
          if (current.state === 'decided' || current.state === 'cancelled') {
            return {
              content: [{ type: 'text' as const, text: `Decision is already ${current.state}.` }],
              isError: true,
            };
          }
          const decision =
            current.state === 'closed'
              ? current
              : ((await decisions.update(String(tripId), decisionId, { state: 'closed' })) as DecisionRecord | null);
          if (!decision) return { content: [{ type: 'text' as const, text: 'Decision not found.' }], isError: true };
          safeBroadcast(tripId, 'decision:updated', { decision });
          return ok({ decision: await summarizeForTrip(tripId, decision, true) });
        } catch (err) {
          return toolError(err, 'Failed to close decision.');
        }
      },
    );

  if (W)
    server.registerTool(
      'finalize_group_decision',
      {
        description:
          'Finalize a group decision by choosing one option. Requires trip edit permission and sets the decision state to decided.',
        inputSchema: {
          tripId: z.number().int().positive(),
          decisionId: z.number().int().positive(),
          optionId: z.number().int().positive().describe('The winning option ID from get_group_decision_status.'),
        },
        annotations: TOOL_ANNOTATIONS_WRITE,
      },
      async ({ tripId, decisionId, optionId }) => {
        if (await isDemoUser(userId)) return demoDenied();
        if (!(await canAccessTrip(tripId, userId))) return noAccess();
        if (!(await hasTripPermission('trip_edit', tripId, userId))) return permissionDenied();

        try {
          const decision = (await decisions.finalize(String(tripId), decisionId, optionId)) as DecisionRecord | null;
          if (!decision) return { content: [{ type: 'text' as const, text: 'Decision not found.' }], isError: true };
          safeBroadcast(tripId, 'decision:updated', { decision });
          return ok({ decision: await summarizeForTrip(tripId, decision, true) });
        } catch (err) {
          return toolError(err, 'Failed to finalize decision.');
        }
      },
    );
}
