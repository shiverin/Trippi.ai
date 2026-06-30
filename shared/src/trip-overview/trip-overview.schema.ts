import { z } from 'zod';

export const tripOverviewStatusSchema = z.enum(['empty', 'good', 'attention', 'urgent']);
export type TripOverviewStatus = z.infer<typeof tripOverviewStatusSchema>;

export const tripOverviewActionSchema = z.enum([
  'decisions',
  'bookings',
  'budget',
  'packing',
  'plan',
  'deadlines',
  'files',
]);
export type TripOverviewAction = z.infer<typeof tripOverviewActionSchema>;

export const tripOverviewSourceSchema = z.enum([
  'decision',
  'todo',
  'reservation',
  'booking_intent',
  'budget',
  'packing',
  'file',
  'trip',
  'plan',
]);
export type TripOverviewSource = z.infer<typeof tripOverviewSourceSchema>;

export const tripOverviewItemSchema = z.object({
  id: z.string(),
  source: tripOverviewSourceSchema,
  source_id: z.number().nullable().optional(),
  title: z.string(),
  meta: z.string(),
  status: tripOverviewStatusSchema.optional(),
});
export type TripOverviewItem = z.infer<typeof tripOverviewItemSchema>;

export const tripOverviewBoardSchema = z.object({
  id: tripOverviewActionSchema,
  title: z.string(),
  summary: z.string(),
  status: tripOverviewStatusSchema,
  count: z.number(),
  action: tripOverviewActionSchema,
  action_label: z.string(),
  empty_title: z.string().optional(),
  empty_text: z.string().optional(),
  metric: z.string().optional(),
  progress: z.number().optional(),
  items: z.array(tripOverviewItemSchema),
});
export type TripOverviewBoard = z.infer<typeof tripOverviewBoardSchema>;

export const tripOverviewReadinessItemSchema = z.object({
  id: z.enum(['decisions', 'balances', 'bookings', 'packing', 'documents']),
  title: z.string(),
  summary: z.string(),
  status: tripOverviewStatusSchema,
  count: z.number(),
  action: tripOverviewActionSchema,
  action_label: z.string(),
});
export type TripOverviewReadinessItem = z.infer<typeof tripOverviewReadinessItemSchema>;

export const tripOverviewReadinessSchema = z.object({
  title: z.string(),
  summary: z.string(),
  status: tripOverviewStatusSchema,
  completed_count: z.number(),
  total_count: z.number(),
  caveat: z.string().optional(),
  items: z.array(tripOverviewReadinessItemSchema),
});
export type TripOverviewReadiness = z.infer<typeof tripOverviewReadinessSchema>;

export const tripOverviewSummarySchema = z.object({
  phase: z.enum(['before', 'during', 'after', 'unscheduled']),
  subtitle: z.string(),
  trip_date_label: z.string(),
  trip_length_label: z.string(),
  traveler_label: z.string(),
  next_deadline_label: z.string(),
  flagged_count: z.number(),
  clear_count: z.number(),
});
export type TripOverviewSummary = z.infer<typeof tripOverviewSummarySchema>;

export const tripOverviewTripSchema = z.object({
  id: z.number(),
  title: z.string(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  currency: z.string(),
});
export type TripOverviewTrip = z.infer<typeof tripOverviewTripSchema>;

export const tripOverviewSchema = z.object({
  generated_at: z.string(),
  trip: tripOverviewTripSchema,
  summary: tripOverviewSummarySchema,
  readiness: tripOverviewReadinessSchema,
  boards: z.array(tripOverviewBoardSchema),
});
export type TripOverview = z.infer<typeof tripOverviewSchema>;

export const tripOverviewResponseSchema = z.object({
  overview: tripOverviewSchema,
});
export type TripOverviewResponse = z.infer<typeof tripOverviewResponseSchema>;
