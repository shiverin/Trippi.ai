import type { McpFeatureFlags } from './featureFlags';
import { registerAssignmentTools } from './tools/assignments';
import { registerAtlasTools } from './tools/atlas';
import { registerBookingIntentTools } from './tools/bookingIntents';
import { registerBudgetTools } from './tools/budget';
import { registerCollabTools } from './tools/collab';
import { registerDayTools } from './tools/days';
import { registerDecisionTools } from './tools/decisions';
import { registerJourneyTools } from './tools/journey';
import { registerMapsWeatherTools } from './tools/mapsWeather';
import { registerNotificationTools } from './tools/notifications';
import { registerPackingTools } from './tools/packing';
import { registerPlaceTools } from './tools/places';
import { registerMcpPrompts } from './tools/prompts';
import { registerReservationTools } from './tools/reservations';
import { registerTagTools } from './tools/tags';
import { registerTodoTools } from './tools/todos';
import { registerTransportTools } from './tools/transports';
import { registerTripTools } from './tools/trips';
import { registerVacayTools } from './tools/vacay';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

export function registerTools(
  server: McpServer,
  userId: number,
  scopes: string[] | null,
  isStaticToken = false,
  getDeprecationNotice: () => string | null = () => null,
  featureFlags?: McpFeatureFlags,
): Promise<void> {
  return (async () => {
    registerTripTools(server, userId, scopes, getDeprecationNotice);

    registerPlaceTools(server, userId, scopes);

    await registerBudgetTools(server, userId, scopes, featureFlags);

    await registerPackingTools(server, userId, scopes, featureFlags);

    registerReservationTools(server, userId, scopes);

    registerBookingIntentTools(server, userId, scopes);

    registerDayTools(server, userId, scopes);

    registerAssignmentTools(server, userId, scopes);

    registerTagTools(server, userId, scopes);

    registerMapsWeatherTools(server, userId, scopes);

    registerNotificationTools(server, userId, scopes);

    await registerAtlasTools(server, userId, scopes, featureFlags);

    await registerCollabTools(server, userId, scopes, featureFlags);

    registerDecisionTools(server, userId, scopes);

    registerTransportTools(server, userId, scopes);

    await registerJourneyTools(server, userId, scopes, featureFlags);

    await registerVacayTools(server, userId, scopes, featureFlags);

    await registerTodoTools(server, userId, scopes, featureFlags);

    await registerMcpPrompts(server, userId, isStaticToken, featureFlags);
  })();
}
