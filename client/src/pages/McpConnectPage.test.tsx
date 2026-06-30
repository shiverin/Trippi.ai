import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../tests/helpers/msw/server';
import { render, screen, within } from '../../tests/helpers/render';
import { resetAllStores } from '../../tests/helpers/store';
import McpConnectPage from './McpConnectPage';

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });
  server.use(http.get('/api/oauth/clients', () => HttpResponse.json({ clients: [] })));
});

describe('McpConnectPage', () => {
  it('renders user-facing MCP explanation and recommended scopes', async () => {
    render(<McpConnectPage />);

    expect(screen.getByRole('heading', { name: /connect an assistant to trippi/i })).toBeInTheDocument();
    expect(screen.getByText(/MCP lets Claude, ChatGPT, Cursor/i)).toBeInTheDocument();
    expect(screen.getByText('Recommended scopes')).toBeInTheDocument();
    expect(screen.getByText('Trip Q&A and summaries')).toBeInTheDocument();
    expect(screen.getAllByText(/trips:read, places:read/i).length).toBeGreaterThan(0);
    await screen.findByText('No OAuth clients yet. Create one below to connect an assistant.');
  });

  it('renders MCP agent recipes with scopes, expected outputs, and v1 no-purchase wording', async () => {
    render(<McpConnectPage />);

    await screen.findByText('No OAuth clients yet. Create one below to connect an assistant.');
    expect(screen.getByRole('heading', { name: /mcp agent recipes/i })).toBeInTheDocument();
    expect(screen.getByText(/V1 can prepare, monitor, and hand off travel work/i)).toBeInTheDocument();
    expect(screen.getByText(/does not purchase flights, hotels, or other provider inventory/i)).toBeInTheDocument();
    expect(screen.getByText(/Traveler confirms bookings/i)).toBeInTheDocument();

    const cheaperHotels = screen.getByRole('article', { name: /find cheaper hotels/i });
    expect(within(cheaperHotels).getByText('Required scopes')).toBeInTheDocument();
    expect(within(cheaperHotels).getByText('reservations:read')).toBeInTheDocument();
    expect(within(cheaperHotels).getByText('budget:read')).toBeInTheDocument();
    expect(within(cheaperHotels).getByText('Expected outputs')).toBeInTheDocument();
    expect(within(cheaperHotels).getByText(/Lower-cost stay shortlist/i)).toBeInTheDocument();
    expect(within(cheaperHotels).getByText(/Provider handoff checklist/i)).toBeInTheDocument();

    const monitorFlights = screen.getByRole('article', { name: /monitor flights/i });
    expect(within(monitorFlights).getByText('todos:write')).toBeInTheDocument();
    expect(within(monitorFlights).getByText(/Flight watch criteria/i)).toBeInTheDocument();

    const rebalanceItinerary = screen.getByRole('article', { name: /rebalance itinerary/i });
    expect(within(rebalanceItinerary).getByText('places:write')).toBeInTheDocument();
    expect(within(rebalanceItinerary).getByText('weather:read')).toBeInTheDocument();
    expect(within(rebalanceItinerary).getByText(/Day-by-day move plan/i)).toBeInTheDocument();

    const packingPlan = screen.getByRole('article', { name: /generate packing plan/i });
    expect(within(packingPlan).getByText('packing:write')).toBeInTheDocument();
    expect(within(packingPlan).getByText(/Weather-aware packing checklist/i)).toBeInTheDocument();

    const tripReadiness = screen.getByRole('article', { name: /summarize trip readiness/i });
    expect(within(tripReadiness).getByText('journey:read')).toBeInTheDocument();
    expect(within(tripReadiness).getByText(/Readiness summary/i)).toBeInTheDocument();
  });

  it('shows existing OAuth clients and copies assistant setup instructions', async () => {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    server.use(
      http.get('/api/oauth/clients', () =>
        HttpResponse.json({
          clients: [
            {
              id: 'client-1',
              name: 'Claude Desktop',
              client_id: 'cid-existing',
              redirect_uris: ['http://localhost'],
              allowed_scopes: ['trips:read', 'places:read'],
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
        })
      )
    );

    render(<McpConnectPage />);

    await screen.findByText('cid-existing');
    expect(screen.getByText('cid-existing')).toBeInTheDocument();
    expect(screen.getByText(/Existing clients do not expose their saved secret/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /copy setup/i }));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('mcp-remote'));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('cid-existing'));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('<client_secret>'));
  });

  it('creates an OAuth client from a workflow preset and shows the one-time secret', async () => {
    const user = userEvent.setup();
    let postedBody: any = null;
    server.use(
      http.post('/api/oauth/clients', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({
          client: {
            id: 'created-1',
            name: postedBody.name,
            client_id: 'cid-created',
            client_secret: 'secret-created',
            redirect_uris: postedBody.redirect_uris,
            allowed_scopes: postedBody.allowed_scopes,
            created_at: '2026-01-01T00:00:00Z',
          },
        });
      })
    );

    render(<McpConnectPage />);

    await screen.findByText('No OAuth clients yet. Create one below to connect an assistant.');
    await user.click(screen.getByRole('button', { name: /packing and tasks/i }));
    await user.click(screen.getByRole('button', { name: /create oauth client/i }));

    await screen.findByText('Client created. Copy the secret now.');
    expect(postedBody).toMatchObject({
      name: 'Claude Desktop',
      redirect_uris: ['http://localhost'],
    });
    expect(postedBody.allowed_scopes).toEqual([
      'trips:read',
      'packing:read',
      'packing:write',
      'todos:read',
      'todos:write',
    ]);
    expect(screen.getAllByText('cid-created').length).toBeGreaterThan(0);
    expect(screen.getByText('secret-created')).toBeInTheDocument();
  });

  it('creates an OAuth client from an agent recipe scope template', async () => {
    const user = userEvent.setup();
    let postedBody: any = null;
    server.use(
      http.post('/api/oauth/clients', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({
          client: {
            id: 'created-recipe',
            name: postedBody.name,
            client_id: 'cid-recipe',
            client_secret: 'secret-recipe',
            redirect_uris: postedBody.redirect_uris,
            allowed_scopes: postedBody.allowed_scopes,
            created_at: '2026-01-01T00:00:00Z',
          },
        });
      })
    );

    render(<McpConnectPage />);

    await screen.findByText('No OAuth clients yet. Create one below to connect an assistant.');
    const packingPlan = screen.getByRole('article', { name: /generate packing plan/i });
    await user.click(within(packingPlan).getByRole('button', { name: /use scopes for generate packing plan/i }));
    await user.click(screen.getByRole('button', { name: /create oauth client/i }));

    await screen.findByText('Client created. Copy the secret now.');
    expect(postedBody.allowed_scopes).toEqual([
      'trips:read',
      'places:read',
      'reservations:read',
      'packing:read',
      'packing:write',
      'todos:read',
      'todos:write',
      'weather:read',
    ]);
  });

  it('switches to ChatGPT guidance and requires a callback redirect URI before creating', async () => {
    const user = userEvent.setup();
    render(<McpConnectPage />);

    await screen.findByText('No OAuth clients yet. Create one below to connect an assistant.');
    await user.click(screen.getByRole('button', { name: /^ChatGPT/i }));
    expect(screen.getByText(/ChatGPT custom MCP app setup/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste the callback URL ChatGPT provides/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create oauth client/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/redirect uri/i), 'https://chatgpt.example/callback');
    expect(screen.getByRole('button', { name: /create oauth client/i })).not.toBeDisabled();
  });

  it('copies the endpoint separately', async () => {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<McpConnectPage />);

    await screen.findByText('No OAuth clients yet. Create one below to connect an assistant.');
    const endpointCard = screen.getByText('MCP endpoint').closest('div')!;
    await user.click(within(endpointCard).getByRole('button', { name: /copy/i }));

    expect(writeSpy).toHaveBeenCalledWith(`${window.location.origin}/mcp`);
  });
});
