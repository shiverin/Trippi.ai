export type TransportType =
  | 'flight'
  | 'train'
  | 'subway'
  | 'cruise'
  | 'car'
  | 'bus'
  | 'taxi'
  | 'bicycle'
  | 'ferry'
  | 'transport_other';

export const TRANSPORT_TYPES: TransportType[] = [
  'flight',
  'train',
  'subway',
  'cruise',
  'car',
  'bus',
  'taxi',
  'bicycle',
  'ferry',
  'transport_other',
];

export const TRANSPORT_COLORS: Record<TransportType, string> = {
  flight: '#111827',
  train: '#dc2626',
  subway: '#7c3aed',
  cruise: '#0891b2',
  car: '#2563eb',
  bus: '#f59e0b',
  taxi: '#ca8a04',
  bicycle: '#16a34a',
  ferry: '#0d9488',
  transport_other: '#64748b',
};

const TRANSPORT_TYPE_SET = new Set<string>(TRANSPORT_TYPES);

export function getTransportRouteType(value: string | null | undefined): TransportType | null {
  const normalized = (value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return null;

  if (normalized === 'rail' || normalized === 'railway' || normalized === 'light_rail' || normalized === 'high_speed_rail') {
    return 'train';
  }
  if (
    normalized === 'drive' ||
    normalized === 'driving' ||
    normalized === 'road' ||
    normalized === 'rental_car' ||
    normalized === 'car_rental' ||
    normalized === 'rental'
  ) {
    return 'car';
  }
  if (normalized === 'bike' || normalized === 'cycling') return 'bicycle';
  if (normalized === 'cab' || normalized === 'rideshare' || normalized === 'ride_share') return 'taxi';
  if (normalized === 'metro' || normalized === 'underground') return 'subway';
  if (normalized === 'ship' || normalized === 'boat') return 'ferry';
  if (normalized === 'walk' || normalized === 'walking') return 'transport_other';

  return TRANSPORT_TYPE_SET.has(normalized) ? (normalized as TransportType) : null;
}

export function normalizeTransportType(value: string | null | undefined): TransportType {
  return getTransportRouteType(value) ?? 'transport_other';
}
