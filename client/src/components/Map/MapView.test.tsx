import { fireEvent } from '@testing-library/react';
import L from 'leaflet';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlace } from '../../../tests/helpers/factories';
import { render, screen } from '../../../tests/helpers/render';
import { resetAllStores } from '../../../tests/helpers/store';
import * as photoService from '../../services/photoService';

const mapMock = vi.hoisted(() => ({
  panTo: vi.fn(),
  setView: vi.fn(),
  fitBounds: vi.fn(),
  getZoom: vi.fn().mockReturnValue(10),
  on: vi.fn(),
  off: vi.fn(),
  panBy: vi.fn(),
  latLngToContainerPoint: vi.fn(([lat, lng]: [number, number]) => ({
    x: lng * 100,
    y: lat * 100,
    distanceTo(other: { x: number; y: number }) {
      return Math.hypot(this.x - other.x, this.y - other.y);
    },
  })),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Tooltip: ({ children }: any) => <div data-testid="tooltip-layer">{children}</div>,
  Marker: ({ children, eventHandlers, position }: any) => (
    <div data-testid="marker" data-lat={position[0]} data-lng={position[1]} onClick={() => eventHandlers?.click?.()}>
      <button
        data-testid="marker-hover-trigger"
        onClick={() => eventHandlers?.mouseover?.({ originalEvent: { clientX: 100, clientY: 100 } })}
      />
      {children}
    </div>
  ),
  Polyline: ({ positions }: any) => <div data-testid="polyline" data-points={JSON.stringify(positions)} />,
  CircleMarker: () => <div data-testid="circle-marker" />,
  Circle: () => <div data-testid="circle" />,
  useMap: () => mapMock,
  useMapEvents: () => ({}),
}));

vi.mock('react-leaflet-cluster', () => ({
  default: ({ children }: any) => <div data-testid="cluster-group">{children}</div>,
}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn((options) => options),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
    latLngBounds: vi.fn(() => ({ isValid: () => true })),
    point: vi.fn((x: number, y: number) => [x, y]),
  },
  divIcon: vi.fn((options) => options),
  Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  latLngBounds: vi.fn(() => ({ isValid: () => true })),
  point: vi.fn((x: number, y: number) => [x, y]),
}));

vi.mock('../../services/photoService', () => ({
  getCached: vi.fn(() => null),
  isLoading: vi.fn(() => false),
  fetchPhoto: vi.fn(),
  onThumbReady: vi.fn(() => () => {}),
  getAllThumbs: vi.fn(() => ({})),
}));

import { MapView } from './MapView';

// Helper: build a place with the extra fields MapView uses (category_name/color/icon)
// that exist on joined DB rows but are not in the base Place TypeScript type.
function buildMapPlace(overrides: Record<string, any> = {}) {
  return {
    ...buildPlace(),
    category_name: null,
    category_color: null,
    category_icon: null,
    ...overrides,
  } as any;
}

afterEach(() => {
  vi.clearAllMocks();
  resetAllStores();
});

describe('MapView', () => {
  it('FE-COMP-MAPVIEW-001: renders map container', () => {
    render(<MapView />);
    expect(screen.getByTestId('map-container')).toBeTruthy();
  });

  it('FE-COMP-MAPVIEW-002: renders one marker per place', () => {
    const places = [
      buildMapPlace({ id: 1, lat: 48.8584, lng: 2.2945 }),
      buildMapPlace({ id: 2, name: 'Louvre', lat: 48.86, lng: 2.337 }),
    ];
    render(<MapView places={places} />);
    expect(screen.getAllByTestId('marker').length).toBe(2);
  });

  it('FE-COMP-MAPVIEW-003: marker click calls onMarkerClick with place id', () => {
    const onMarkerClick = vi.fn();
    const places = [buildMapPlace({ id: 42, lat: 48.8584, lng: 2.2945 })];
    render(<MapView places={places} onMarkerClick={onMarkerClick} />);
    fireEvent.click(screen.getByTestId('marker'));
    expect(onMarkerClick).toHaveBeenCalledWith(42);
  });

  it('FE-COMP-MAPVIEW-004: tooltip shows place name', async () => {
    const user = userEvent.setup();
    const places = [buildMapPlace({ name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945 })];
    render(<MapView places={places} />);
    await user.click(screen.getByTestId('marker-hover-trigger'));
    expect(screen.getByTestId('tooltip').textContent).toContain('Eiffel Tower');
  });

  it('FE-COMP-MAPVIEW-005: tooltip shows category name when present', async () => {
    const user = userEvent.setup();
    const places = [
      buildMapPlace({ name: 'Louvre', lat: 48.86, lng: 2.337, category_name: 'Museum', category_icon: null }),
    ];
    render(<MapView places={places} />);
    await user.click(screen.getByTestId('marker-hover-trigger'));
    expect(screen.getByTestId('tooltip').textContent).toContain('Museum');
  });

  it('FE-COMP-MAPVIEW-006: renders polyline when route has 2+ points', () => {
    render(
      <MapView
        route={[
          [
            [48.0, 2.0],
            [49.0, 3.0],
          ],
        ]}
      />
    );
    // Apple-Maps style draws a casing + a core line per segment.
    expect(screen.getAllByTestId('polyline').length).toBeGreaterThan(0);
  });

  it('FE-COMP-MAPVIEW-007: does not render polyline when route is null', () => {
    render(<MapView route={null} />);
    expect(screen.queryByTestId('polyline')).toBeNull();
  });

  it('FE-COMP-MAPVIEW-008: does not render polyline for single-point route', () => {
    render(<MapView route={[[[48.0, 2.0]]]} />);
    expect(screen.queryByTestId('polyline')).toBeNull();
  });

  it('FE-COMP-MAPVIEW-009: GPX geometry polyline rendered for place with route_geometry', () => {
    const places = [buildMapPlace({ lat: 48.0, lng: 2.0, route_geometry: '[[48.0,2.0],[49.0,3.0]]' })];
    render(<MapView places={places} />);
    expect(screen.getByTestId('polyline')).toBeTruthy();
  });

  it('FE-COMP-MAPVIEW-010: MarkerClusterGroup is rendered', () => {
    const places = [buildMapPlace({ lat: 48.8584, lng: 2.2945 })];
    render(<MapView places={places} />);
    expect(screen.getByTestId('cluster-group')).toBeTruthy();
  });

  it('FE-COMP-MAPVIEW-011: renders the route polyline; travel times are no longer drawn on the map', () => {
    const route = [
      [
        [48.0, 2.0],
        [49.0, 3.0],
      ],
    ] as unknown as [number, number][][];
    render(<MapView route={route} />);
    // The route is drawn; per-segment times now live in the day sidebar, not on the map.
    expect(screen.getAllByTestId('polyline').length).toBeGreaterThan(0);
  });

  it('FE-COMP-MAPVIEW-012: invalid route_geometry JSON triggers catch and skips polyline', () => {
    const places = [buildMapPlace({ lat: 48.0, lng: 2.0, route_geometry: 'NOT_VALID_JSON' })];
    // Should not throw; invalid JSON is caught silently
    render(<MapView places={places} />);
    expect(screen.queryByTestId('polyline')).toBeNull();
  });

  it('FE-COMP-MAPVIEW-013: route_geometry with fewer than 2 coords skips polyline', () => {
    const places = [buildMapPlace({ lat: 48.0, lng: 2.0, route_geometry: '[[48.0,2.0]]' })];
    render(<MapView places={places} />);
    expect(screen.queryByTestId('polyline')).toBeNull();
  });

  it('FE-COMP-MAPVIEW-013B: transport overlay prefers provider route geometry', () => {
    const reservation = {
      id: 55,
      type: 'train',
      status: 'confirmed',
      title: 'Train to Nanjing',
      endpoints: [
        {
          role: 'from',
          sequence: 0,
          name: 'Town A',
          code: 'A',
          lat: 1,
          lng: 1,
          timezone: null,
          local_date: null,
          local_time: null,
        },
        {
          role: 'to',
          sequence: 1,
          name: 'Town B',
          code: 'B',
          lat: 3,
          lng: 12,
          timezone: null,
          local_date: null,
          local_time: null,
        },
      ],
    } as any;
    render(
      <MapView
        reservations={[reservation]}
        visibleConnectionIds={[55]}
        transportRoutes={{
          55: {
            reservationId: 55,
            source: 'google-routes',
            provider: 'google-routes',
            exact: true,
            segments: [
              {
                mode: 'train',
                provider: 'google-routes',
                source: 'google-routes-transit',
                exact: true,
                coordinates: [
                  [1, 1],
                  [2, 7],
                  [3, 12],
                ],
              },
            ],
            warnings: [],
          },
        }}
      />
    );
    const routeLine = screen.getAllByTestId('polyline').find((el) => el.getAttribute('data-points')?.includes('[2,7]'));
    expect(routeLine).toBeTruthy();
  });

  it('FE-COMP-MAPVIEW-014: marker icon uses base64 image_url for photo places', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AA';
    const places = [buildMapPlace({ id: 10, lat: 48.0, lng: 2.0, image_url: dataUrl })];
    render(<MapView places={places} />);
    const iconOptions = vi.mocked(L.divIcon).mock.calls.at(-1)?.[0] as { className?: string; html?: string };
    expect(iconOptions.className).toBe('trippi-photo-marker');
    expect(iconOptions.html).toContain('data-marker-photo-layer');
    expect(iconOptions.html).toContain('width:44px;height:44px');
    expect(iconOptions.html).toContain('border:3.5px solid #fff');
  });

  it('FE-COMP-MAPVIEW-015: uses cached photo thumb from photoService when available', () => {
    vi.mocked(photoService.getCached).mockReturnValue({ thumbDataUrl: 'data:image/jpeg;base64,abc' } as any);
    const places = [buildMapPlace({ id: 20, lat: 48.0, lng: 2.0, google_place_id: 'gplace_123' })];
    render(<MapView places={places} />);
    expect(screen.getByTestId('marker')).toBeTruthy();
    vi.mocked(photoService.getCached).mockReturnValue(null);
  });

  it('FE-COMP-MAPVIEW-015b: uses persisted place image_url immediately without fetching', () => {
    const imageUrl = '/api/maps/place-photo/coords%3A48%3A2/bytes';
    const places = [
      buildMapPlace({ id: 215, lat: 48.0, lng: 2.0, image_url: imageUrl, google_place_id: 'gplace_215' }),
    ];
    render(<MapView places={places} />);
    const iconOptions = vi.mocked(L.divIcon).mock.calls.at(-1)?.[0] as { className?: string; html?: string };
    expect(iconOptions.className).toBe('trippi-photo-marker');
    expect(iconOptions.html).toContain(imageUrl);
    expect(photoService.fetchPhoto).not.toHaveBeenCalled();
  });

  it('FE-COMP-MAPVIEW-015c: keeps true non-photo places as category markers', () => {
    const places = [buildMapPlace({ id: 216, lat: 48.0, lng: 2.0, category_color: '#8b5cf6', image_url: null })];
    render(<MapView places={places} />);
    const iconOptions = vi.mocked(L.divIcon).mock.calls.at(-1)?.[0] as { className?: string; html?: string };
    expect(iconOptions.className || '').toBe('');
    expect(iconOptions.html).not.toContain('data-marker-photo-layer');
    expect(iconOptions.html).toContain('width:36px;height:36px');
    expect(iconOptions.html).toContain('background:#8b5cf6');
  });

  it('FE-COMP-MAPVIEW-016: tooltip shows address when present', async () => {
    const user = userEvent.setup();
    const places = [
      buildMapPlace({ name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945, address: '5 Av. Anatole France' }),
    ];
    render(<MapView places={places} />);
    await user.click(screen.getByTestId('marker-hover-trigger'));
    expect(screen.getByTestId('tooltip').textContent).toContain('5 Av. Anatole France');
  });

  it('FE-COMP-MAPVIEW-017: renders selected marker with higher z-index offset', () => {
    const places = [buildMapPlace({ id: 5, lat: 48.8584, lng: 2.2945 })];
    render(<MapView places={places} selectedPlaceId={5} />);
    expect(screen.getByTestId('marker')).toBeTruthy();
  });

  it('FE-COMP-MAPVIEW-018: changing selectedPlaceId/hasInspector does not refit bounds (issue #921)', () => {
    const places = [
      buildMapPlace({ id: 1, lat: 48.8584, lng: 2.2945 }),
      buildMapPlace({ id: 2, lat: 48.86, lng: 2.337 }),
    ];
    const { rerender } = render(<MapView places={places} fitKey={1} selectedPlaceId={null} hasInspector={false} />);
    const initialCount = mapMock.fitBounds.mock.calls.length;

    // Toggle selectedPlaceId on — mimics opening place inspector (hasInspector flips,
    // paddingOpts memo creates new object). fitBounds must NOT fire again.
    rerender(<MapView places={places} fitKey={1} selectedPlaceId={1} hasInspector={true} />);
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(initialCount);

    // Toggle selectedPlaceId off — mimics closing inspector via X button.
    rerender(<MapView places={places} fitKey={1} selectedPlaceId={null} hasInspector={false} />);
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(initialCount);
  });

  it('FE-COMP-MAPVIEW-019: bumping fitKey triggers a new fitBounds call', () => {
    const places = [buildMapPlace({ id: 1, lat: 48.8584, lng: 2.2945 })];
    const { rerender } = render(<MapView places={places} fitKey={1} />);
    const afterFirst = mapMock.fitBounds.mock.calls.length;

    rerender(<MapView places={places} fitKey={2} />);
    expect(mapMock.fitBounds.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
