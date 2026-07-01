export const ITINERARY_PLANNING_QUALITY_CHECKLIST = [
  'Build curated, realistic schedules rather than landmark lists. Normal full sightseeing days should usually have 5-8 locatable items; arrival, departure, transit-heavy, and deliberate rest days may have fewer but must include the logistics that make the day work.',
  'Give every day a clear theme, city, start times, realistic durations, and a sensible geographic flow. Cluster nearby stops and include material transfers instead of pretending distant places are adjacent.',
  'Include meals, cafe/rest/reset slots, hotel check-ins or check-outs, reservations, airport or station buffers, and backup notes when they affect the trip experience.',
  'Write activity descriptions with local texture: why this stop is here, what to do or order, what to watch for, and what makes it fit the day.',
  'Use notes for practical details such as booking windows, passport or ticket requirements, crowd timing, weather considerations, meeting points, and plan-B choices.',
  'Use categories, duration_minutes, price, currency, day city, destination_context, accommodation, and cover_place_query whenever the user request gives enough context.',
] as const;

export const ITINERARY_PLANNING_QUALITY_TEXT = ITINERARY_PLANNING_QUALITY_CHECKLIST.map((item) => `- ${item}`).join(
  '\n',
);

export const APPLY_ITINERARY_PLAN_TOOL_DESCRIPTION =
  'Create or update a complete multi-day itinerary in one structured JSON call. Use this as the primary one-shot tool for "plan a trip", "full itinerary", "generate travel plan", and PDF itinerary requests. Activities are imported as real places with day assignments, never as day notes. Produce a meticulous, realistic itinerary: full sightseeing days usually need 5-8 scheduled locatable items, with meals, buffers, transport, hotel logistics, practical notes, costs, and local detail. Send location query/address/provider IDs and let the server geocode; include lat/lng only when they are known from a reliable source, never invented. The server validates, attaches a destination cover image from resolved itinerary places, applies atomically, and optionally exports the official Trippi PDF. For PDF requests, optionally set cover_place_query to the strongest scenic or landmark place from the itinerary; do not send an image URL.';
