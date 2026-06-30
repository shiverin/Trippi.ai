import { Car, CarTaxiFront, Footprints, Hotel, Plane, Train } from 'lucide-react';
import type { RouteSegment } from '../../types';
import { formatDistance } from '../../utils/units';

/** Slim travel-time connector shown beside the row that owns a travel leg. */
export function RouteConnector({
  seg,
  profile,
  label,
}: {
  seg: RouteSegment;
  profile: 'driving' | 'walking';
  label?: string;
}) {
  const driving = profile === 'driving';
  const Icon = driving ? Car : Footprints;
  const line = { flex: 1, height: 1, minHeight: 1, alignSelf: 'center', background: 'var(--border-primary)' };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 14px',
        fontSize: 10.5,
        color: 'var(--text-faint)',
        lineHeight: 1.2,
      }}
    >
      <div style={line} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
        <Icon size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
        {label && (
          <>
            <span
              style={{
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
          </>
        )}
        <span style={{ flexShrink: 0 }}>{seg.durationText ?? (driving ? seg.drivingText : seg.walkingText)}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ flexShrink: 0 }}>{seg.distanceText}</span>
      </div>
      <div style={line} />
    </div>
  );
}

function formatSuggestionDuration(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(1, Math.round(minutes)) : 1;
  if (safe < 60) return `${safe} min`;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function RouteSuggestionConnector({
  seg,
  sameCity,
  distanceUnit,
}: {
  seg: RouteSegment;
  sameCity: boolean;
  distanceUnit: 'metric' | 'imperial';
}) {
  const distanceKm = Math.max(0, (seg.distance || 0) / 1000);
  const walkingMinutes = Math.round((distanceKm / 5) * 60);
  const subwayMinutes = formatSuggestionDuration((distanceKm / 28) * 60 + 8);
  const trainMinutes = formatSuggestionDuration((distanceKm / 180) * 60 + 25);
  const flightMinutes = formatSuggestionDuration((distanceKm / 750) * 60 + 110);
  const options = sameCity
    ? [
        { label: 'Taxi', time: seg.drivingText || seg.durationText, Icon: CarTaxiFront },
        { label: 'Subway', time: subwayMinutes, Icon: Train },
        ...(walkingMinutes > 0 && walkingMinutes <= 60
          ? [{ label: 'Walk', time: seg.walkingText, Icon: Footprints }]
          : []),
      ]
    : [
        { label: 'Train', time: trainMinutes, Icon: Train },
        { label: 'Flight', time: flightMinutes, Icon: Plane },
        { label: 'Car', time: seg.drivingText || seg.durationText, Icon: Car },
      ];
  const line = { flex: 1, height: 1, minHeight: 1, alignSelf: 'center', background: 'var(--border-primary)' };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 14px',
        color: 'var(--text-faint)',
        lineHeight: 1.2,
      }}
    >
      <div style={line} />
      <div style={{ minWidth: 0, flex: '0 1 auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            marginBottom: 4,
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          <span>Suggested transfer</span>
          <span style={{ opacity: 0.45 }}>·</span>
          <span>{formatDistance(distanceKm, distanceUnit)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
          {options.map(({ label, time, Icon }) => (
            <span
              key={label}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 5px',
                borderRadius: 5,
                background: 'var(--bg-hover)',
                color: 'var(--text-muted)',
                fontSize: 9.5,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={10} strokeWidth={2} />
              <span>{label}</span>
              <span style={{ opacity: 0.45 }}>·</span>
              <span style={{ fontWeight: 500 }}>{time}</span>
            </span>
          ))}
        </div>
      </div>
      <div style={line} />
    </div>
  );
}

/**
 * The hotel's bookend legs for a day: a two-line connector naming the day's
 * accommodation with the drive to/from it. Rendered above the first place (the
 * morning departure from the hotel) and below the last place (the evening return),
 * when the "optimize from accommodation" setting is on and the day has a hotel.
 */
export function HotelRouteConnector({
  seg,
  profile,
  name,
  placement,
}: {
  seg: RouteSegment;
  profile: 'driving' | 'walking';
  name: string;
  placement: 'top' | 'bottom';
}) {
  const driving = profile === 'driving';
  const Icon = driving ? Car : Footprints;
  const line = { flex: 1, height: 1, minHeight: 1, alignSelf: 'center', background: 'var(--border-primary)' };
  const hotelRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '0 14px',
        minWidth: 0,
      }}
    >
      <Hotel size={12} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.2,
        }}
      >
        {name}
      </span>
    </div>
  );
  const travelRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 14px',
        fontSize: 10.5,
        color: 'var(--text-faint)',
        lineHeight: 1.2,
      }}
    >
      <div style={line} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <Icon size={11} strokeWidth={2} />
        <span>{seg.durationText ?? (driving ? seg.drivingText : seg.walkingText)}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{seg.distanceText}</span>
      </div>
      <div style={line} />
    </div>
  );
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: placement === 'top' ? '2px 0 6px' : '6px 0 2px',
      }}
    >
      {placement === 'top' ? (
        <>
          {hotelRow}
          {travelRow}
        </>
      ) : (
        <>
          {travelRow}
          {hotelRow}
        </>
      )}
    </div>
  );
}
