export type TripPdfTranslation = (key: string, params?: Record<string, string | number>) => string;

export interface TripPdfTrip {
  id?: number | string;
  title?: string | null;
  description?: string | null;
  cover_image?: string | null;
  currency?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface TripPdfCategory {
  id: number | string;
  name?: string | null;
  icon?: string | null;
  color?: string | null;
}

export interface TripPdfPlace {
  id: number | string;
  name?: string | null;
  description?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  address?: string | null;
  category_id?: number | string | null;
  price?: number | string | null;
  currency?: string | null;
  place_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  image_url?: string | null;
  google_place_id?: string | null;
  osm_id?: string | null;
  category?: TripPdfCategory | null;
}

export interface TripPdfAssignment {
  id?: number | string;
  day_id?: number | string;
  order_index?: number | null;
  notes?: string | null;
  place?: TripPdfPlace | null;
}

export interface TripPdfDay {
  id: number | string;
  day_number?: number | null;
  title?: string | null;
  date?: string | null;
}

export interface TripPdfDayNote {
  id?: number | string;
  day_id: number | string;
  text?: string | null;
  time?: string | null;
  icon?: string | null;
  sort_order?: number | null;
}

export interface TripPdfReservationEndpoint {
  code?: string | null;
  name?: string | null;
  local_time?: string | null;
  sequence?: number | null;
}

export interface TripPdfReservation {
  id?: number | string;
  title?: string | null;
  type?: string | null;
  day_id?: number | string | null;
  end_day_id?: number | string | null;
  day_plan_position?: number | null;
  day_positions?: Record<string, number | null | undefined> | null;
  reservation_time?: string | null;
  reservation_end_time?: string | null;
  confirmation_number?: string | null;
  location?: string | null;
  metadata?: unknown;
  endpoints?: TripPdfReservationEndpoint[] | null;
}

export interface TripPdfAccommodation {
  id?: number | string;
  start_day_id: number | string;
  end_day_id: number | string;
  check_in?: string | null;
  check_out?: string | null;
  place_name?: string | null;
  place_address?: string | null;
  notes?: string | null;
  confirmation?: string | null;
}

export interface BuildTripPdfHtmlInput {
  trip: TripPdfTrip;
  days: TripPdfDay[];
  places: TripPdfPlace[];
  assignments: Record<string, TripPdfAssignment[]>;
  categories: TripPdfCategory[];
  dayNotes: TripPdfDayNote[];
  reservations?: TripPdfReservation[];
  accommodations?: TripPdfAccommodation[];
  photoMap?: Record<string, string | null | undefined>;
  t?: TripPdfTranslation;
  locale?: string;
  origin: string;
}

interface FlightLeg {
  from: string | null;
  to: string | null;
  airline?: string;
  flight_number?: string;
}

type MergedItem =
  | { type: 'place'; k: number; data: TripPdfAssignment }
  | { type: 'note'; k: number; data: TripPdfDayNote }
  | { type: 'reservation'; k: number; data: TripPdfReservation };

const DEFAULT_ICON_PATH = '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>';

const ICON_PATHS: Record<string, string> = {
  AlertTriangle:
    '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  BedDouble:
    '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/><path d="M12 10V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/><path d="M2 18h20"/>',
  Bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l1.5 4"/><path d="M9 6h3l3 6H8l-2.5 5.5"/><path d="m12 6-2 6"/>',
  Bookmark: '<path d="M19 21 12 17 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/>',
  Bus: '<path d="M8 6v6"/><path d="M16 6v6"/><path d="M4 12h16"/><path d="M6 18h.01"/><path d="M18 18h.01"/><rect x="4" y="3" width="16" height="16" rx="2"/><path d="M6 19v2"/><path d="M18 19v2"/>',
  Camera:
    '<path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z"/><circle cx="12" cy="13" r="3"/>',
  Car: '<path d="M19 17h2l-2-6-2-4H7l-2 4-2 6h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 11h14"/>',
  CarTaxiFront:
    '<path d="M10 2h4"/><path d="M8 2h8l1 3H7l1-3Z"/><path d="M6 17h12"/><path d="M5 17v4"/><path d="M19 17v4"/><path d="m6 9-2 6v2h16v-2l-2-6Z"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/>',
  Clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  Coffee:
    '<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/>',
  FileText:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  Flag: '<path d="M4 22V4"/><path d="M4 4h12l-1 4 1 4H4"/>',
  Heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
  Hotel:
    '<path d="M10 22V8H4v14"/><path d="M20 22V4H10"/><path d="M14 8h2"/><path d="M14 12h2"/><path d="M14 16h2"/><path d="M4 12h6"/><path d="M2 22h20"/>',
  Info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  KeyRound: '<path d="M2 18a6 6 0 1 0 10.7-3.7L22 5l-3-3-9.3 9.3A6 6 0 0 0 2 18Z"/><path d="m15 5 3 3"/>',
  Lightbulb:
    '<path d="M15 14c.2-1 .8-1.7 1.5-2.5A6 6 0 1 0 7.5 11.5C8.2 12.3 8.8 13 9 14"/><path d="M9 18h6"/><path d="M10 22h4"/><path d="M10 14h4"/>',
  LogIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  LogOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  MapPin: DEFAULT_ICON_PATH,
  Navigation: '<path d="m3 11 19-9-9 19-2-8-8-2Z"/>',
  Plane:
    '<path d="M17.8 19.2 16 11l5.4-5.4a2 2 0 0 0-2.8-2.8L13 8 4.8 6.2 3.4 7.6l6.4 3.2-4.2 4.2-2.8-.7-1.1 1.1 4.2 2.1 2.1 4.2 1.1-1.1-.7-2.8 4.2-4.2 3.2 6.4 1.4-1.4Z"/>',
  Route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h3a6 6 0 0 0 0-12H9"/>',
  Sailboat: '<path d="M22 18H2l3 4h14l3-4Z"/><path d="M12 2v16"/><path d="m12 2 7 10H12"/><path d="m12 6-5 6h5"/>',
  Ship: '<path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 1 4 0 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1"/><path d="M4 18 2 9l10-4 10 4-2 9"/><path d="M12 5v13"/><path d="M5 12h14"/>',
  ShoppingBag:
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  Star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1L12 2Z"/>',
  Ticket:
    '<path d="M2 9a3 3 0 0 0 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 0 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v14"/>',
  Train:
    '<path d="M4 15.5V6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v9.5a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 15.5Z"/><path d="M8 19 6 22"/><path d="M16 19l2 3"/><path d="M8 7h8"/><path d="M8 12h8"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>',
  Users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  Utensils:
    '<path d="M3 2v7a3 3 0 0 0 6 0V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Z"/><path d="M21 15v7"/>',
};

const NOTE_ICON_MAP: Record<string, string> = {
  AlertTriangle: 'AlertTriangle',
  Bookmark: 'Bookmark',
  Bus: 'Bus',
  Camera: 'Camera',
  Car: 'Car',
  Clock: 'Clock',
  Coffee: 'Coffee',
  FileText: 'FileText',
  Flag: 'Flag',
  Heart: 'Heart',
  Info: 'Info',
  Lightbulb: 'Lightbulb',
  MapPin: 'MapPin',
  Navigation: 'Navigation',
  Plane: 'Plane',
  ShoppingBag: 'ShoppingBag',
  Ship: 'Ship',
  Star: 'Star',
  Ticket: 'Ticket',
  Train: 'Train',
};

const RESERVATION_ICON_MAP: Record<string, string> = {
  bicycle: 'Bike',
  bus: 'Bus',
  car: 'Car',
  cruise: 'Ship',
  event: 'Ticket',
  ferry: 'Sailboat',
  flight: 'Plane',
  other: 'FileText',
  restaurant: 'Utensils',
  taxi: 'CarTaxiFront',
  tour: 'Users',
  train: 'Train',
  transport_other: 'Route',
};

const RESERVATION_COLOR_MAP: Record<string, string> = {
  bicycle: '#84cc16',
  bus: '#059669',
  car: '#6b7280',
  cruise: '#0ea5e9',
  event: '#f59e0b',
  ferry: '#0d9488',
  flight: '#3b82f6',
  other: '#6b7280',
  restaurant: '#ef4444',
  taxi: '#ca8a04',
  tour: '#10b981',
  train: '#06b6d4',
  transport_other: '#6b7280',
};

const ACCOMMODATION_ICON_MAP: Record<string, string> = {
  accommodation: 'Hotel',
  checkin: 'LogIn',
  checkout: 'LogOut',
  confirmation: 'KeyRound',
  location: 'MapPin',
  note: 'FileText',
};

const CATEGORY_ICON_ALIASES: Record<string, string> = {
  Activity: 'Star',
  Anchor: 'MapPin',
  Backpack: 'ShoppingBag',
  BedDouble: 'BedDouble',
  Beer: 'Coffee',
  Bike: 'Bike',
  Building2: 'Hotel',
  Bus: 'Bus',
  Camera: 'Camera',
  Car: 'Car',
  Coffee: 'Coffee',
  Compass: 'Navigation',
  CreditCard: 'Ticket',
  Flag: 'Flag',
  Heart: 'Heart',
  Hotel: 'Hotel',
  Landmark: 'MapPin',
  Luggage: 'ShoppingBag',
  Map: 'MapPin',
  MapPin: 'MapPin',
  Mountain: 'MapPin',
  Music: 'Star',
  Navigation: 'Navigation',
  Plane: 'Plane',
  Ship: 'Ship',
  ShoppingBag: 'ShoppingBag',
  Star: 'Star',
  Store: 'ShoppingBag',
  Ticket: 'Ticket',
  Train: 'Train',
  Utensils: 'Utensils',
  UtensilsCrossed: 'Utensils',
  Wine: 'Coffee',
};

const svgPin =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="#94a3b8" style="flex-shrink:0;margin-top:1px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white"/></svg>';
const svgClock =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
const svgEuro =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round"><path d="M14 5c-3.87 0-7 3.13-7 7s3.13 7 7 7c2.17 0 4.1-.99 5.4-2.55"/><path d="M5 11h8M5 13h8"/></svg>';

function escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  const str = stringValue(value);
  return str || undefined;
}

function iconSvg(
  iconName: string | null | undefined,
  options: { size?: number; strokeWidth?: number; color?: string; className?: string } = {},
): string {
  const size = options.size ?? 14;
  const color = options.color ?? '#94a3b8';
  const strokeWidth = options.strokeWidth ?? 1.8;
  const resolvedName = iconName && ICON_PATHS[iconName] ? iconName : 'MapPin';
  const path = ICON_PATHS[resolvedName] ?? DEFAULT_ICON_PATH;
  const classAttr = options.className ? ` class="${escHtml(options.className)}"` : '';
  return `<svg${classAttr} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${escHtml(color)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function noteIconSvg(iconId: string | null | undefined): string {
  return iconSvg(NOTE_ICON_MAP[iconId || ''] || 'FileText', { size: 14, strokeWidth: 1.8, color: '#94a3b8' });
}

function reservationIconSvg(type: string | null | undefined): string {
  const reservationType = type || 'other';
  return iconSvg(RESERVATION_ICON_MAP[reservationType] || 'Ticket', {
    size: 14,
    strokeWidth: 1.8,
    color: RESERVATION_COLOR_MAP[reservationType] || '#3b82f6',
  });
}

function accommodationIconSvg(type: string): string {
  return iconSvg(ACCOMMODATION_ICON_MAP[type] || 'BedDouble', {
    size: 14,
    strokeWidth: 1.8,
    color: '#03398f',
    className: 'accommodation-icon',
  });
}

function categoryIconSvg(iconName: string | null | undefined, size = 24): string {
  return iconSvg(CATEGORY_ICON_ALIASES[iconName || ''] || 'MapPin', {
    size,
    strokeWidth: 1.8,
    color: 'rgba(255,255,255,0.92)',
  });
}

function absUrl(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  return origin.replace(/\/+$/, '') + (url.startsWith('/') ? '' : '/') + url;
}

function safeImg(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('data:')) return url;
  if (url.startsWith('/api/maps/place-photo/')) return absUrl(url, origin);
  return /\.(jpe?g|png|webp|bmp|tiff?)(\?.*)?$/i.test(url) ? absUrl(url, origin) : null;
}

function shortDate(date: string | null | undefined, locale: string): string {
  if (!date) return '';
  return new Date(date + 'T00:00:00Z').toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function longDateRange(days: TripPdfDay[], locale: string): string | null {
  const dated = [...days].filter((day) => day.date).sort((a, b) => getDayOrder(a, days) - getDayOrder(b, days));
  if (!dated.length) return null;
  const first = new Date(dated[0]!.date + 'T00:00:00Z');
  const last = new Date(dated[dated.length - 1]!.date + 'T00:00:00Z');
  return `${first.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })} - ${last.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

function dayCost(
  assignments: Record<string, TripPdfAssignment[]>,
  dayId: number | string,
  locale: string,
): string | null {
  const total = (assignments[String(dayId)] || []).reduce(
    (sum, assignment) => sum + (Number.parseFloat(String(assignment.place?.price ?? '')) || 0),
    0,
  );
  return total > 0 ? `${total.toLocaleString(locale)} EUR` : null;
}

function getDayOrder(day: TripPdfDay, days: TripPdfDay[]): number {
  return day.day_number ?? days.indexOf(day) + 1;
}

function isDayInAccommodationRange(
  day: TripPdfDay,
  startDayId: number | string,
  endDayId: number | string,
  days: TripPdfDay[],
): boolean {
  const startDay = days.find((candidate) => candidate.id === startDayId);
  const endDay = days.find((candidate) => candidate.id === endDayId);
  if (!startDay || !endDay) {
    const dayId = Number(day.id);
    return (
      dayId >= Math.min(Number(startDayId), Number(endDayId)) && dayId <= Math.max(Number(startDayId), Number(endDayId))
    );
  }
  const lo = Math.min(getDayOrder(startDay, days), getDayOrder(endDay, days));
  const hi = Math.max(getDayOrder(startDay, days), getDayOrder(endDay, days));
  return getDayOrder(day, days) >= lo && getDayOrder(day, days) <= hi;
}

function parseReservationMetadata(reservation: TripPdfReservation): Record<string, unknown> {
  const metadata = reservation.metadata;
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      let parsed: unknown = JSON.parse(metadata || '{}');
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          return {};
        }
      }
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return asRecord(metadata);
}

function orderedEndpoints(reservation: TripPdfReservation): TripPdfReservationEndpoint[] {
  return (reservation.endpoints || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

function getFlightLegs(reservation: TripPdfReservation): FlightLeg[] {
  const metadata = parseReservationMetadata(reservation);
  const rawLegs = metadata.legs;
  if (Array.isArray(rawLegs) && rawLegs.length > 0) {
    return rawLegs.map((rawLeg) => {
      const leg = asRecord(rawLeg);
      return {
        from: stringValue(leg.from) || null,
        to: stringValue(leg.to) || null,
        airline: optionalString(leg.airline),
        flight_number: optionalString(leg.flight_number),
      };
    });
  }

  const endpoints = orderedEndpoints(reservation);
  const first = endpoints[0];
  const last = endpoints[endpoints.length - 1];
  const fromCode = first?.code ?? optionalString(metadata.departure_airport) ?? null;
  const toCode = last?.code ?? optionalString(metadata.arrival_airport) ?? null;
  if (!fromCode && !toCode) return [];
  return [
    {
      from: fromCode,
      to: toCode,
      airline: optionalString(metadata.airline),
      flight_number: optionalString(metadata.flight_number),
    },
  ];
}

function splitReservationDateTime(value?: string | null): { date: string | null; time: string | null } {
  if (!value) return { date: null, time: null };
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (value.includes('T')) {
    const [date, time] = value.split('T');
    return { date: isoDate.test(date || '') ? date || null : null, time: time ? time.slice(0, 5) : null };
  }
  if (isoDate.test(value)) return { date: value, time: null };
  if (/^\d{1,2}:\d{2}/.test(value)) return { date: null, time: value.slice(0, 5) };
  return { date: null, time: null };
}

function getSpanPhase(reservation: TripPdfReservation, dayId: number | string): 'single' | 'start' | 'middle' | 'end' {
  const startId = reservation.day_id;
  const endId = reservation.end_day_id ?? startId;
  if (startId == null || startId === endId) return 'single';
  if (dayId === startId) return 'start';
  if (dayId === endId) return 'end';
  return 'middle';
}

function getDisplayTime(reservation: TripPdfReservation, dayId: number | string): string | null {
  const phase = getSpanPhase(reservation, dayId);
  if (phase === 'end') return reservation.reservation_end_time || null;
  if (phase === 'middle') return null;
  return reservation.reservation_time || null;
}

function getSpanLabel(reservation: TripPdfReservation, phase: string, t: TripPdfTranslation): string | null {
  if (phase === 'single') return null;
  if (reservation.type === 'flight') {
    return t(`reservations.span.${phase === 'start' ? 'departure' : phase === 'end' ? 'arrival' : 'inTransit'}`);
  }
  if (reservation.type === 'car') {
    return t(`reservations.span.${phase === 'start' ? 'pickup' : phase === 'end' ? 'return' : 'active'}`);
  }
  return t(`reservations.span.${phase === 'start' ? 'start' : phase === 'end' ? 'end' : 'ongoing'}`);
}

function getTransportForDay(
  reservations: TripPdfReservation[],
  days: TripPdfDay[],
  dayId: number | string,
): TripPdfReservation[] {
  return reservations.filter((reservation) => {
    if (reservation.type === 'hotel') return false;
    const startId = reservation.day_id;
    const endId = reservation.end_day_id ?? startId;
    if (startId == null) return false;
    if (endId !== startId) {
      const startDay = days.find((day) => day.id === startId);
      const endDay = days.find((day) => day.id === endId);
      const thisDay = days.find((day) => day.id === dayId);
      if (!startDay || !endDay || !thisDay) return false;
      return (
        getDayOrder(thisDay, days) >= getDayOrder(startDay, days) &&
        getDayOrder(thisDay, days) <= getDayOrder(endDay, days)
      );
    }
    return startId === dayId;
  });
}

function translated(t: TripPdfTranslation | undefined): TripPdfTranslation {
  return t || ((key) => key);
}

export function buildTripPdfHtml(input: BuildTripPdfHtmlInput): string {
  const locale = input.locale || 'en-US';
  const t = translated(input.t);
  const sorted = [...(input.days || [])].sort(
    (a, b) => getDayOrder(a, input.days || []) - getDayOrder(b, input.days || []),
  );
  const range = longDateRange(sorted, locale);
  const coverImg = safeImg(input.trip?.cover_image, input.origin);
  const accommodations = input.accommodations || [];
  const reservations = input.reservations || [];
  const assignments = input.assignments || {};
  const categories = input.categories || [];
  const places = input.places || [];
  const photoMap = input.photoMap || {};

  const totalAssigned = new Set(
    Object.values(assignments)
      .flatMap((dayAssignments) => dayAssignments.map((assignment) => assignment.place?.id))
      .filter((placeId): placeId is number | string => placeId != null),
  ).size;
  const totalCost = Object.values(assignments)
    .flatMap((dayAssignments) => dayAssignments)
    .reduce((sum, assignment) => sum + (Number(assignment.place?.price) || 0), 0);

  const daysHtml = sorted
    .map((day, dayIndex) => {
      const assigned = assignments[String(day.id)] || [];
      const notes = (input.dayNotes || []).filter((note) => note.day_id === day.id);
      const cost = dayCost(assignments, day.id, locale);
      const dayReservations = getTransportForDay(reservations, sorted, day.id).filter(
        (reservation) => !(reservation.type === 'car' && getSpanPhase(reservation, day.id) === 'middle'),
      );

      const merged: MergedItem[] = [];
      assigned.forEach((assignment) =>
        merged.push({ type: 'place', k: assignment.order_index ?? 0, data: assignment }),
      );
      notes.forEach((note) => merged.push({ type: 'note', k: note.sort_order ?? 0, data: note }));
      dayReservations.forEach((reservation) => {
        const directPosition = reservation.day_positions?.[String(day.id)];
        const fallbackPosition =
          reservation.day_plan_position ?? (merged.length > 0 ? Math.max(...merged.map((item) => item.k)) + 0.5 : 0.5);
        merged.push({ type: 'reservation', k: directPosition ?? fallbackPosition, data: reservation });
      });
      merged.sort((a, b) => a.k - b.k);

      let placeIndex = 0;
      const itemsHtml =
        merged.length === 0
          ? `<div class="empty-day">${escHtml(t('dayplan.emptyDay'))}</div>`
          : merged
              .map((item) => {
                if (item.type === 'reservation') {
                  const reservation = item.data;
                  const metadata = parseReservationMetadata(reservation);
                  const reservationType = reservation.type || 'other';
                  const icon = reservationIconSvg(reservationType);
                  const color = RESERVATION_COLOR_MAP[reservationType] || '#3b82f6';
                  let subtitle = '';
                  let subtitleLines: string[] = [];
                  if (reservation.type === 'flight') {
                    const legs = getFlightLegs(reservation);
                    if (legs.length > 1) {
                      subtitleLines = legs
                        .map((leg) =>
                          [
                            leg.airline,
                            leg.flight_number,
                            leg.from || leg.to ? [leg.from, leg.to].filter(Boolean).join(' -> ') : '',
                          ]
                            .filter(Boolean)
                            .join(' - '),
                        )
                        .filter(Boolean);
                    } else {
                      const stops = orderedEndpoints(reservation)
                        .map((endpoint) => endpoint.code || endpoint.name)
                        .filter(Boolean);
                      const route =
                        stops.length >= 2
                          ? stops.join(' -> ')
                          : metadata.departure_airport && metadata.arrival_airport
                            ? `${stringValue(metadata.departure_airport)} -> ${stringValue(metadata.arrival_airport)}`
                            : '';
                      subtitle = [metadata.airline, metadata.flight_number, route]
                        .filter(Boolean)
                        .map(String)
                        .join(' - ');
                    }
                  } else if (reservation.type === 'train') {
                    subtitle = [
                      metadata.train_number,
                      metadata.platform ? `Gl. ${stringValue(metadata.platform)}` : '',
                      metadata.seat ? `Seat ${stringValue(metadata.seat)}` : '',
                    ]
                      .filter(Boolean)
                      .map(String)
                      .join(' - ');
                  } else if (reservation.type === 'restaurant') {
                    subtitle = [metadata.party_size ? `${String(metadata.party_size)} guests` : '']
                      .filter(Boolean)
                      .join(' - ');
                  } else if (reservation.type === 'event') {
                    subtitle = [metadata.venue].filter(Boolean).map(String).join(' - ');
                  } else if (reservation.type === 'tour') {
                    subtitle = [metadata.operator].filter(Boolean).map(String).join(' - ');
                  }
                  if (subtitleLines.length === 0 && subtitle) subtitleLines = [subtitle];
                  const locationLine = reservation.location || stringValue(metadata.location);
                  const phase = getSpanPhase(reservation, day.id);
                  const spanLabel = getSpanLabel(reservation, phase, t);
                  const displayTime = getDisplayTime(reservation, day.id);
                  const time = splitReservationDateTime(displayTime).time ?? '';
                  const titleHtml = `${spanLabel ? escHtml(spanLabel) + ': ' : ''}${escHtml(reservation.title || '')}`;
                  return `
              <div class="note-card" style="border-left: 3px solid ${color};">
                <div class="note-line" style="background: ${color};"></div>
                <span class="note-icon">${icon}</span>
                <div class="note-body">
                  <div class="note-text" style="font-weight: 600;">${titleHtml}${time ? ` <span style="color:#6b7280;font-weight:400;font-size:10px;">${time}</span>` : ''}</div>
                  ${subtitleLines
                    .filter(Boolean)
                    .map((line) => `<div class="note-time">${escHtml(line)}</div>`)
                    .join('')}
                  ${locationLine ? `<div class="note-time">${escHtml(locationLine)}</div>` : ''}
                  ${reservation.confirmation_number ? `<div class="note-time" style="font-size:9px;">Code: ${escHtml(reservation.confirmation_number)}</div>` : ''}
                </div>
              </div>`;
                }

                if (item.type === 'note') {
                  const note = item.data;
                  return `
              <div class="note-card">
                <div class="note-line"></div>
                <span class="note-icon">${noteIconSvg(note.icon)}</span>
                <div class="note-body">
                  <div class="note-text">${escHtml(note.text)}</div>
                  ${note.time ? `<div class="note-time">${escHtml(note.time)}</div>` : ''}
                </div>
              </div>`;
                }

                placeIndex += 1;
                const place = item.data.place;
                if (!place) return '';
                const category =
                  categories.find((candidate) => candidate.id === place.category_id) || place.category || null;
                const color = category?.color || '#6366f1';
                const directImg = safeImg(place.image_url, input.origin);
                const googleImg = safeImg(photoMap[String(place.id)] || null, input.origin);
                const img = directImg || googleImg;
                const iconSvg = categoryIconSvg(category?.icon, 24);
                const thumbHtml = img
                  ? `<img class="place-thumb" src="${escHtml(img)}" />`
                  : `<div class="place-thumb-fallback" style="background:${color}">
                 ${iconSvg}
               </div>`;

                const chips = [
                  place.place_time ? `<span class="chip">${svgClock}${escHtml(place.place_time)}</span>` : '',
                  place.price && Number.parseFloat(String(place.price)) > 0
                    ? `<span class="chip chip-green">${svgEuro}${Number(place.price).toLocaleString(locale)} EUR</span>`
                    : '',
                ]
                  .filter(Boolean)
                  .join('');

                const lat = place.lat != null ? Number(place.lat) : null;
                const lng = place.lng != null ? Number(place.lng) : null;

                return `
            <div class="place-card">
              <div class="place-bar" style="background:${color}"></div>
              ${thumbHtml}
              <div class="place-info">
                <div class="place-name-row">
                  <span class="place-num">${placeIndex}</span>
                  <span class="place-name">${escHtml(place.name)}</span>
                  ${category ? `<span class="cat-badge" style="background:${color}">${escHtml(category.name)}</span>` : ''}
                </div>
                ${place.address ? `<div class="info-row">${svgPin}<span class="info-text">${escHtml(place.address)}</span></div>` : ''}
                ${lat != null && lng != null ? `<div class="info-row"><span class="info-spacer"></span><span class="info-text muted">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>` : ''}
                ${place.description ? `<div class="info-row"><span class="info-spacer"></span><span class="info-text muted italic">${escHtml(place.description)}</span></div>` : ''}
                ${chips ? `<div class="chips">${chips}</div>` : ''}
                ${place.notes ? `<div class="info-row"><span class="info-spacer"></span><span class="info-text muted italic">${escHtml(place.notes)}</span></div>` : ''}
              </div>
            </div>`;
              })
              .join('');

      const accommodationsForDay = accommodations
        .filter((accommodation) =>
          isDayInAccommodationRange(day, accommodation.start_day_id, accommodation.end_day_id, sorted),
        )
        .sort((a, b) => {
          const startA = sorted.find((candidate) => candidate.id === a.start_day_id);
          const startB = sorted.find((candidate) => candidate.id === b.start_day_id);
          return (startA ? getDayOrder(startA, sorted) : 0) - (startB ? getDayOrder(startB, sorted) : 0);
        });

      const accommodationDetails = accommodationsForDay
        .map((accommodation) => {
          const isCheckIn = day.id === accommodation.start_day_id;
          const isCheckOut = day.id === accommodation.end_day_id;
          const actionLabel = isCheckIn
            ? t('reservations.meta.checkIn')
            : isCheckOut
              ? t('reservations.meta.checkOut')
              : t('reservations.meta.linkAccommodation');
          const actionIcon = isCheckIn
            ? accommodationIconSvg('checkin')
            : isCheckOut
              ? accommodationIconSvg('checkout')
              : accommodationIconSvg('accommodation');
          const timeStr = isCheckIn ? accommodation.check_in || '' : isCheckOut ? accommodation.check_out || '' : '';

          return `
        <div class="day-accommodation">
          <div class="day-accommodation-title accommodation-center-icon">${actionIcon} ${escHtml(actionLabel)}</div>
          ${timeStr ? `<div class="accommodation-center-icon">${accommodationIconSvg('checkin')} <b>${escHtml(timeStr)}</b></div>` : ''}
          <div class="accommodation-center-icon">${accommodationIconSvg('accommodation')} ${escHtml(accommodation.place_name)}</div>
          ${accommodation.place_address ? `<div class="accommodation-center-icon">${accommodationIconSvg('location')} ${escHtml(accommodation.place_address)}</div>` : ''}
          ${accommodation.notes ? `<div class="accommodation-center-icon">${accommodationIconSvg('note')} ${escHtml(accommodation.notes)}</div>` : ''}
          ${isCheckIn && accommodation.confirmation ? `<div class="accommodation-center-icon">${accommodationIconSvg('confirmation')} ${escHtml(accommodation.confirmation)}</div>` : ''}
        </div>`;
        })
        .join('');

      const accommodationsHtml =
        accommodationsForDay.length > 0
          ? `<div class="day-accommodations-overview">
          <div class="day-accommodations ${accommodationsForDay.length === 1 ? 'single' : ''}">${accommodationDetails}</div>
        </div>`
          : '';

      const displayDayNumber = day.day_number ?? dayIndex + 1;

      return `
      <div class="day-section${dayIndex > 0 ? ' page-break' : ''}">
        <div class="day-header">
          <span class="day-tag">${escHtml(t('dayplan.dayN', { n: displayDayNumber })).toUpperCase()}</span>
          <span class="day-title">${escHtml(day.title || t('dayplan.dayN', { n: displayDayNumber }))}</span>
          ${day.date ? `<span class="day-date">${shortDate(day.date, locale)}</span>` : ''}
          ${cost ? `<span class="day-cost">${cost}</span>` : ''}
        </div>
        <div class="day-body">${accommodationsHtml}${itemsHtml}</div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${escHtml(locale.split('-')[0] || 'en')}">
<head>
<meta charset="UTF-8">
<base href="${escHtml(input.origin.replace(/\/+$/, ''))}/">
<title>${escHtml(input.trip?.title || t('pdf.travelPlan'))}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Poppins', sans-serif; background: #fff; color: #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  svg { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .pdf-footer {
    position: fixed;
    bottom: 20px;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    opacity: 0.3;
  }
  .pdf-footer span {
    font-size: 7px;
    color: #64748b;
    letter-spacing: 0.5px;
  }

  .cover {
    width: 100%; min-height: 100vh;
    background: #0f172a;
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 52px; position: relative; overflow: hidden;
  }
  .cover-bg {
    position: absolute; inset: 0;
    background-size: cover; background-position: center;
    opacity: 0.28;
  }
  .cover-dim { position: absolute; inset: 0; background: rgba(8,12,28,0.55); }
  .cover-brand {
    position: absolute; top: 36px; right: 52px;
    z-index: 2;
  }
  .cover-body { position: relative; z-index: 1; }
  .cover-circle {
    width: 100px; height: 100px; border-radius: 50%;
    overflow: hidden; border: 2.5px solid rgba(255,255,255,0.25);
    margin-bottom: 26px; flex-shrink: 0;
  }
  .cover-circle img { width: 100%; height: 100%; object-fit: cover; }
  .cover-circle-ph {
    width: 100px; height: 100px; border-radius: 50%;
    background: rgba(255,255,255,0.07);
    margin-bottom: 26px;
  }
  .cover-label { font-size: 9px; font-weight: 600; letter-spacing: 2.5px; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-bottom: 8px; }
  .cover-title { font-size: 42px; font-weight: 700; color: #fff; line-height: 1.1; margin-bottom: 8px; }
  .cover-desc  { font-size: 13px; color: rgba(255,255,255,0.55); line-height: 1.6; margin-bottom: 18px; max-width: 420px; }
  .cover-dates { font-size: 12px; color: rgba(255,255,255,0.45); margin-bottom: 30px; }
  .cover-line  { height: 1px; background: rgba(255,255,255,0.1); margin-bottom: 24px; }
  .cover-stats { display: flex; gap: 36px; }
  .cover-stat-num { font-size: 28px; font-weight: 700; color: #fff; line-height: 1; }
  .cover-stat-lbl { font-size: 9px; font-weight: 500; color: rgba(255,255,255,0.4); letter-spacing: 1px; margin-top: 4px; text-transform: uppercase; }

  .page-break { page-break-before: always; }
  .day-header {
    background: #0f172a; padding: 11px 28px;
    display: flex; align-items: center; gap: 8px;
  }
  .day-tag { font-size: 8px; font-weight: 700; color: #fff; letter-spacing: 0.8px; background: rgba(255,255,255,0.12); border-radius: 4px; padding: 3px 8px; flex-shrink: 0; }
  .day-title { font-size: 13px; font-weight: 600; color: #fff; flex: 1; }
  .day-date  { font-size: 9px; color: rgba(255,255,255,0.45); }
  .day-cost  { font-size: 9px; font-weight: 600; color: rgba(255,255,255,0.65); }
  .day-body  { padding: 12px 28px 6px; }

  .day-accommodations-overview { font-size: 12px; }
  .day-accommodations { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
  .day-accommodations.single { justify-content: center; }
  .day-accommodation {
    flex: 1 1 45%; min-width: 200px; margin: 4px 0; padding: 10px;
    border: 2px solid #e2e8f0; border-radius: 12px;
    display: flex; flex-direction: column;
  }
  .day-accommodation-title {
    font-size: 16px; font-weight: 600; text-align: center;
    margin-bottom: 4px; align-self: center;
  }
  .accommodation-center-icon { display: flex; align-items: center; gap: 4px; }

  .place-card {
    display: flex; align-items: stretch;
    border: 1px solid #e2e8f0; border-radius: 8px;
    margin-bottom: 8px; overflow: hidden;
    background: #fff; page-break-inside: avoid;
  }
  .place-bar { width: 4px; flex-shrink: 0; }
  .place-thumb {
    width: 52px; height: 52px; object-fit: cover;
    margin: 8px; border-radius: 6px; flex-shrink: 0;
  }
  .place-thumb-fallback {
    width: 52px; height: 52px; margin: 8px; border-radius: 8px;
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  }
  .place-thumb-fallback svg { width: 24px; height: 24px; }
  .place-info { flex: 1; padding: 9px 10px 8px 0; min-width: 0; }

  .place-name-row { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; }
  .place-num {
    width: 16px; height: 16px; border-radius: 50%;
    background: #1e293b; color: #fff; font-size: 8px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .place-name { font-size: 11.5px; font-weight: 600; color: #1e293b; flex: 1; }
  .cat-badge { font-size: 7.5px; font-weight: 600; color: #fff; border-radius: 99px; padding: 2px 7px; flex-shrink: 0; white-space: nowrap; }

  .info-row { display: flex; align-items: flex-start; gap: 4px; margin-bottom: 2px; padding-left: 21px; }
  .info-row svg { flex-shrink: 0; margin-top: 1px; }
  .info-spacer { width: 13px; flex-shrink: 0; }
  .info-text { font-size: 9px; color: #64748b; line-height: 1.5; }
  .info-text.muted { color: #94a3b8; }
  .info-text.italic { font-style: italic; }

  .chips { display: flex; flex-wrap: wrap; gap: 4px; padding-left: 21px; margin-top: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 3px; font-size: 8px; font-weight: 600; background: #f1f5f9; color: #374151; border-radius: 99px; padding: 2px 7px; white-space: nowrap; }
  .chip svg { flex-shrink: 0; }
  .chip-green { background: #ecfdf5; color: #059669; }
  .chip-amber { background: #fffbeb; color: #d97706; }

  .note-card {
    display: flex; align-items: center; gap: 8px;
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
    padding: 8px 10px; margin-bottom: 7px; page-break-inside: avoid;
  }
  .note-line { width: 3px; border-radius: 99px; background: #94a3b8; align-self: stretch; flex-shrink: 0; }
  .note-icon { flex-shrink: 0; }
  .note-body { flex: 1; min-width: 0; }
  .note-text { font-size: 9.5px; color: #334155; line-height: 1.55; }
  .note-time { font-size: 8px; color: #94a3b8; margin-top: 2px; }

  .empty-day { font-size: 9.5px; color: #cbd5e1; font-style: italic; text-align: center; padding: 14px 0; }

  @media print {
    body { margin: 0; }
    .cover { min-height: 100vh; page-break-after: always; }
    @page { margin: 0; }
  }
</style>
</head>
<body>

<div class="pdf-footer">
  <span>made with</span>
  <img src="${absUrl('/brand/trippi-wordmark.png', input.origin)}" style="height:12px;opacity:0.65;" />
</div>

<div class="cover">
  ${coverImg ? `<div class="cover-bg" style="background-image:url('${escHtml(coverImg)}')"></div>` : ''}
  <div class="cover-dim"></div>
  <div class="cover-brand"><img src="${absUrl('/brand/trippi-wordmark-light.png', input.origin)}" style="height:30px;opacity:0.6;" /></div>
  <div class="cover-body">
    ${
      coverImg
        ? `<div class="cover-circle"><img src="${escHtml(coverImg)}" /></div>`
        : '<div class="cover-circle-ph"></div>'
    }
    <div class="cover-label">${escHtml(t('pdf.travelPlan'))}</div>
    <div class="cover-title">${escHtml(input.trip?.title || 'My Trip')}</div>
    ${input.trip?.description ? `<div class="cover-desc">${escHtml(input.trip.description)}</div>` : ''}
    ${range ? `<div class="cover-dates">${range}</div>` : ''}
    <div class="cover-line"></div>
    <div class="cover-stats">
      <div>
        <div class="cover-stat-num">${sorted.length}</div>
        <div class="cover-stat-lbl">${escHtml(t('dashboard.days'))}</div>
      </div>
      <div>
        <div class="cover-stat-num">${places?.length || 0}</div>
        <div class="cover-stat-lbl">${escHtml(t('dashboard.places'))}</div>
      </div>
      <div>
        <div class="cover-stat-num">${totalAssigned}</div>
        <div class="cover-stat-lbl">${escHtml(t('pdf.planned'))}</div>
      </div>
      ${
        totalCost > 0
          ? `<div>
        <div class="cover-stat-num">${totalCost.toLocaleString(locale)}</div>
        <div class="cover-stat-lbl">${escHtml(t('pdf.costLabel'))}</div>
      </div>`
          : ''
      }
    </div>
  </div>
</div>

${daysHtml}

</body></html>`;
}
