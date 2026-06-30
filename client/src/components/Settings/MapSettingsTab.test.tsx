// FE-COMP-MAP-001 to FE-COMP-MAP-017
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { buildSettings, buildUser } from '../../../tests/helpers/factories';
import { server } from '../../../tests/helpers/msw/server';
import { render, screen, waitFor } from '../../../tests/helpers/render';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ToastContainer } from '../shared/Toast';
import MapSettingsTab from './MapSettingsTab';

// Mock MapView to avoid Leaflet DOM issues in jsdom
vi.mock('../Map/MapView', () => ({
  MapView: ({ onMapClick }: { onMapClick?: (info: { latlng: { lat: number; lng: number } }) => void }) => (
    <div data-testid="map-view" onClick={() => onMapClick?.({ latlng: { lat: 51.5, lng: -0.1 } })} />
  ),
}));

function entitlementPayload(overrides: any = {}) {
  return {
    entitlements: {
      userId: 1,
      planKey: 'free',
      billingPlanKey: 'free',
      billingStatus: 'free',
      subscribed: false,
      trialing: false,
      limits: {
        aiWorkers: 0,
        priceWatches: 0,
        mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
        activeTrips: 5,
        groupSize: null,
      },
      ...(overrides.entitlements ?? {}),
    },
    billing: {
      checkoutAvailable: false,
      defaultPlanId: null,
      portalAvailable: false,
      ...(overrides.billing ?? {}),
    },
  };
}

function enableProMaps() {
  server.use(
    http.get('/api/billing/entitlements', () =>
      HttpResponse.json(
        entitlementPayload({
          entitlements: {
            planKey: 'pro',
            billingPlanKey: 'pro',
            billingStatus: 'active',
            subscribed: true,
            limits: {
              aiWorkers: 0,
              priceWatches: 0,
              mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
              activeTrips: 100,
              groupSize: null,
            },
          },
        })
      )
    )
  );
}

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });
  seedStore(useSettingsStore, {
    settings: buildSettings({
      map_tile_url: '',
      default_lat: 48.8566,
      default_lng: 2.3522,
      default_zoom: 10,
    }),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  });
});

describe('MapSettingsTab', () => {
  it('FE-COMP-MAP-001: renders without crashing', () => {
    render(<MapSettingsTab />);
    expect(document.body).toBeInTheDocument();
  });

  it('FE-COMP-MAP-002: shows the Map section title', () => {
    render(<MapSettingsTab />);
    expect(screen.getByText('Map')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-003: shows the map template label', () => {
    render(<MapSettingsTab />);
    expect(screen.getByText('Map Template')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-004: shows latitude and longitude inputs', () => {
    render(<MapSettingsTab />);
    expect(screen.getByText('Latitude')).toBeInTheDocument();
    expect(screen.getByText('Longitude')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-005: latitude input is pre-filled from store settings', () => {
    render(<MapSettingsTab />);
    expect(screen.getByDisplayValue('48.8566')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-006: longitude input is pre-filled from store settings', () => {
    render(<MapSettingsTab />);
    expect(screen.getByDisplayValue('2.3522')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-007: typing in the latitude input updates its displayed value', async () => {
    const user = userEvent.setup();
    render(<MapSettingsTab />);
    const latInput = screen.getByDisplayValue('48.8566');
    await user.clear(latInput);
    await user.type(latInput, '51.5');
    expect(screen.getByDisplayValue('51.5')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-008: typing in the longitude input updates its displayed value', async () => {
    const user = userEvent.setup();
    render(<MapSettingsTab />);
    const lngInput = screen.getByDisplayValue('2.3522');
    await user.clear(lngInput);
    await user.type(lngInput, '-0.1');
    expect(screen.getByDisplayValue('-0.1')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-009: tile URL text input is shown', () => {
    render(<MapSettingsTab />);
    const tileInput = screen.getByPlaceholderText(/openstreetmap/i);
    expect(tileInput).toBeInTheDocument();
  });

  it('FE-COMP-MAP-010: typing a custom tile URL updates the text input', async () => {
    enableProMaps();
    const user = userEvent.setup();
    render(<MapSettingsTab />);
    const tileInput = screen.getByPlaceholderText(/openstreetmap/i);
    await waitFor(() => expect(tileInput).not.toBeDisabled());
    await user.clear(tileInput);
    // Escape curly braces so userEvent doesn't treat them as special keys
    await user.type(tileInput, 'https://custom.tiles/{{z}/{{x}/{{y}.png');
    expect(screen.getByDisplayValue('https://custom.tiles/{z}/{x}/{y}.png')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-011: clicking the Save Map button calls updateSettings', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    seedStore(useSettingsStore, {
      settings: buildSettings({ map_tile_url: '', default_lat: 48.8566, default_lng: 2.3522, default_zoom: 10 }),
      updateSettings,
    });
    render(<MapSettingsTab />);
    await user.click(screen.getByText('Save Map'));
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        map_tile_url: expect.any(String),
        default_lat: expect.any(Number),
        default_lng: expect.any(Number),
        default_zoom: expect.any(Number),
      })
    );
  });

  it('FE-COMP-MAP-012: Save Map parses numeric values correctly', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    seedStore(useSettingsStore, {
      settings: buildSettings({ map_tile_url: '', default_lat: 48.8566, default_lng: 2.3522, default_zoom: 10 }),
      updateSettings,
    });
    render(<MapSettingsTab />);
    await user.click(screen.getByText('Save Map'));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        map_tile_url: '',
        default_lat: 48.8566,
        default_lng: 2.3522,
        default_zoom: 10,
      })
    );
  });

  it('FE-COMP-MAP-013: Save Map button shows spinner while saving', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn().mockReturnValue(new Promise(() => {}));
    seedStore(useSettingsStore, {
      settings: buildSettings(),
      updateSettings,
    });
    render(<MapSettingsTab />);
    await user.click(screen.getByText('Save Map'));
    const saveBtn = screen.getByText('Save Map').closest('button')!;
    expect(saveBtn).toBeDisabled();
  });

  it('FE-COMP-MAP-014: Save Map error shows a toast', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn().mockRejectedValue(new Error('Save failed'));
    seedStore(useSettingsStore, {
      settings: buildSettings(),
      updateSettings,
    });
    render(
      <>
        <ToastContainer />
        <MapSettingsTab />
      </>
    );
    await user.click(screen.getByText('Save Map'));
    await screen.findByText('Save failed');
  });

  it('FE-COMP-MAP-015: clicking the map updates lat/lng state', async () => {
    const user = userEvent.setup();
    render(<MapSettingsTab />);
    await user.click(screen.getByTestId('map-view'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('51.5')).toBeInTheDocument();
      expect(screen.getByDisplayValue('-0.1')).toBeInTheDocument();
    });
  });

  it('FE-COMP-MAP-016: preset dropdown is rendered', () => {
    render(<MapSettingsTab />);
    expect(screen.getByText('Select template...')).toBeInTheDocument();
  });

  it('FE-COMP-MAP-017: settings update from store syncs local state', async () => {
    const { rerender } = render(<MapSettingsTab />);
    expect(screen.getByDisplayValue('48.8566')).toBeInTheDocument();

    seedStore(useSettingsStore, {
      settings: buildSettings({ default_lat: 40.0 }),
    });
    rerender(<MapSettingsTab />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('40')).toBeInTheDocument();
    });
  });

  it('FE-COMP-MAP-018: free users are locked to the default 2D map controls', async () => {
    render(<MapSettingsTab />);

    await screen.findByText('Pro map options locked');
    expect(screen.getByRole('button', { name: /Mapbox/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /MapLibre/i })).toBeDisabled();
    expect(screen.getByPlaceholderText(/openstreetmap/i)).toBeDisabled();
  });

  it('FE-COMP-MAP-019: free users save back to default 2D map settings', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    seedStore(useSettingsStore, {
      settings: buildSettings({
        map_provider: 'mapbox-gl',
        map_tile_url: 'https://custom.tiles/{z}/{x}/{y}.png',
        mapbox_access_token: 'pk.previous',
        mapbox_3d_enabled: true,
        mapbox_quality_mode: true,
      }),
      updateSettings,
    });

    render(<MapSettingsTab />);
    await screen.findByText('Pro map options locked');
    await user.click(screen.getByText('Save Map'));

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        map_provider: 'leaflet',
        map_tile_url: '',
        mapbox_access_token: '',
        mapbox_style: expect.any(String),
        maplibre_style: '',
        mapbox_3d_enabled: false,
        mapbox_quality_mode: false,
      })
    );
  });

  it('FE-COMP-MAP-020: pro users can unlock premium map controls', async () => {
    enableProMaps();
    const user = userEvent.setup();
    render(<MapSettingsTab />);

    const tileInput = screen.getByPlaceholderText(/openstreetmap/i);
    await waitFor(() => expect(tileInput).not.toBeDisabled());
    const mapboxButton = screen.getByRole('button', { name: /Mapbox/i });
    expect(mapboxButton).not.toBeDisabled();

    await user.click(mapboxButton);
    expect(screen.getByText('Mapbox Access Token')).toBeInTheDocument();
  });
});
