import { z } from 'zod';

export const friendRelationSchema = z.object({
  is_following: z.boolean(),
  follows_you: z.boolean(),
});
export type FriendRelation = z.infer<typeof friendRelationSchema>;

export const friendUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  avatar_url: z.string().nullable(),
  follower_count: z.number(),
  following_count: z.number(),
  is_following: z.boolean(),
  follows_you: z.boolean(),
  shared_trip_count: z.number().optional(),
});
export type FriendUser = z.infer<typeof friendUserSchema>;

export const friendStatsCountrySchema = z.object({
  code: z.string(),
  trip_count: z.number(),
  place_count: z.number(),
  first_visit_year: z.number().nullable(),
  last_visit_year: z.number().nullable(),
});
export type FriendStatsCountry = z.infer<typeof friendStatsCountrySchema>;

export const friendStatsSchema = z.object({
  total_trips: z.number(),
  total_places: z.number(),
  total_countries: z.number(),
  total_days: z.number(),
  total_cities: z.number(),
  countries: z.array(friendStatsCountrySchema),
  continents: z.record(z.string(), z.number()),
  streak: z.number(),
  first_year: z.number().nullable(),
  trips_this_year: z.number(),
});
export type FriendStats = z.infer<typeof friendStatsSchema>;

export const friendSharePermissionsSchema = z.object({
  share_map: z.boolean(),
  share_bookings: z.boolean(),
  share_packing: z.boolean(),
  share_budget: z.boolean(),
  share_collab: z.boolean(),
});
export type FriendSharePermissions = z.infer<typeof friendSharePermissionsSchema>;

export const friendSharedTripSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  cover_image: z.string().nullable(),
  token: z.string(),
  day_count: z.number(),
  place_count: z.number(),
  country_count: z.number(),
  permissions: friendSharePermissionsSchema,
});
export type FriendSharedTrip = z.infer<typeof friendSharedTripSchema>;

export const friendsHubResponseSchema = z.object({
  me: z.object({
    follower_count: z.number(),
    following_count: z.number(),
  }),
  following: z.array(friendUserSchema),
  suggestions: z.array(friendUserSchema),
});
export type FriendsHubResponse = z.infer<typeof friendsHubResponseSchema>;

export const friendsSearchResponseSchema = z.object({
  users: z.array(friendUserSchema),
});
export type FriendsSearchResponse = z.infer<typeof friendsSearchResponseSchema>;

export const friendProfileResponseSchema = z.object({
  user: friendUserSchema,
  stats: friendStatsSchema,
  shared_trips: z.array(friendSharedTripSchema),
});
export type FriendProfileResponse = z.infer<typeof friendProfileResponseSchema>;

export const friendFollowResponseSchema = z.object({
  success: z.boolean(),
  user: friendUserSchema.optional(),
});
export type FriendFollowResponse = z.infer<typeof friendFollowResponseSchema>;
