import { registerAssignmentTools } from './tools/assignments';
import { registerAtlasTools } from './tools/atlas';
import { registerBudgetTools } from './tools/budget';
import { registerCollabTools } from './tools/collab';
import { registerDayTools } from './tools/days';
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
): void {
  registerTripTools(server, userId, scopes, getDeprecationNotice);

  registerPlaceTools(server, userId, scopes);

  registerBudgetTools(server, userId, scopes);

  registerPackingTools(server, userId, scopes);

  registerReservationTools(server, userId, scopes);

  registerDayTools(server, userId, scopes);

  registerAssignmentTools(server, userId, scopes);

  registerTagTools(server, userId, scopes);

  registerMapsWeatherTools(server, userId, scopes);

  registerNotificationTools(server, userId, scopes);

  registerAtlasTools(server, userId, scopes);

  registerCollabTools(server, userId, scopes);

  registerTransportTools(server, userId, scopes);

  registerJourneyTools(server, userId, scopes);

  registerVacayTools(server, userId, scopes);

  registerTodoTools(server, userId, scopes);

  registerMcpPrompts(server, userId, isStaticToken);
}
