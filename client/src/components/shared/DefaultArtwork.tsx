import { Compass, Globe2, MapPin, Plane, Users } from 'lucide-react';
import React from 'react';
import './DefaultArtwork.css';

type ArtworkKind = 'avatar' | 'empty' | 'friends' | 'journey' | 'place' | 'share' | 'trip';
type ArtworkTone = 'full' | 'mini' | 'soft';

interface DefaultArtworkProps {
  kind?: ArtworkKind;
  seed?: number | string;
  tone?: ArtworkTone;
  className?: string;
  icon?: boolean;
  ariaLabel?: string;
}

const PALETTES = [
  {
    bg: '#172033',
    bg2: '#496b8c',
    a: '#f1d49b',
    b: '#9ed8f2',
    c: '#f59f8f',
    aSoft: 'rgba(241, 212, 155, 0.28)',
    bSoft: 'rgba(158, 216, 242, 0.32)',
    cSoft: 'rgba(245, 159, 143, 0.22)',
  },
  {
    bg: '#12343b',
    bg2: '#487f84',
    a: '#f2d98d',
    b: '#a7d8de',
    c: '#e89f71',
    aSoft: 'rgba(242, 217, 141, 0.28)',
    bSoft: 'rgba(167, 216, 222, 0.34)',
    cSoft: 'rgba(232, 159, 113, 0.24)',
  },
  {
    bg: '#2c243c',
    bg2: '#9b675c',
    a: '#f3cf82',
    b: '#93c5d8',
    c: '#d6b4e8',
    aSoft: 'rgba(243, 207, 130, 0.3)',
    bSoft: 'rgba(147, 197, 216, 0.26)',
    cSoft: 'rgba(214, 180, 232, 0.24)',
  },
  {
    bg: '#1f2e2f',
    bg2: '#657f72',
    a: '#d9ed92',
    b: '#a7c7e7',
    c: '#f1c78e',
    aSoft: 'rgba(217, 237, 146, 0.24)',
    bSoft: 'rgba(167, 199, 231, 0.3)',
    cSoft: 'rgba(241, 199, 142, 0.22)',
  },
  {
    bg: '#14213d',
    bg2: '#3a506b',
    a: '#fca311',
    b: '#bde0fe',
    c: '#e5e7eb',
    aSoft: 'rgba(252, 163, 17, 0.24)',
    bSoft: 'rgba(189, 224, 254, 0.3)',
    cSoft: 'rgba(229, 231, 235, 0.2)',
  },
  {
    bg: '#153f42',
    bg2: '#0e7490',
    a: '#fed7aa',
    b: '#bae6fd',
    c: '#bbf7d0',
    aSoft: 'rgba(254, 215, 170, 0.28)',
    bSoft: 'rgba(186, 230, 253, 0.3)',
    cSoft: 'rgba(187, 247, 208, 0.22)',
  },
];

const ROUTES = [
  'M76 355 C172 240 250 318 340 214 S548 156 704 236',
  'M96 220 C196 112 318 174 404 252 S594 386 708 236',
  'M94 302 C210 354 258 142 390 180 S566 312 720 148',
  'M84 170 C176 274 286 114 398 246 S604 312 716 188',
];

const CONTOURS = [
  'M-30 132 C94 82 154 184 282 126 S500 80 620 134 S812 180 846 112',
  'M-24 192 C98 144 178 236 302 184 S504 142 654 198 S798 232 852 186',
  'M-20 410 C116 358 196 436 318 382 S526 316 668 376 S780 424 846 368',
];

const COASTS = [
  'M-20 382 C94 338 142 410 240 356 S374 286 490 324 S636 386 820 318 L820 520 L-20 520 Z',
  'M-20 332 C84 270 184 330 276 280 S436 192 548 248 S688 356 820 270 L820 520 L-20 520 Z',
  'M-20 386 C90 316 184 372 282 320 S418 226 548 284 S690 394 820 328 L820 520 L-20 520 Z',
];

const ICONS = {
  avatar: Compass,
  empty: Compass,
  friends: Users,
  journey: Compass,
  place: MapPin,
  share: Globe2,
  trip: Plane,
};

export function artworkSeedFromString(value: string | null | undefined): number {
  return Array.from(value || 'trippi').reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 17);
}

function normalizeSeed(seed: number | string | undefined): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.trunc(seed));
  return artworkSeedFromString(String(seed ?? 'trippi'));
}

export function DefaultArtwork({
  kind = 'trip',
  seed = 0,
  tone = 'full',
  className = '',
  icon = true,
  ariaLabel,
}: DefaultArtworkProps): React.ReactElement {
  const normalizedSeed = normalizeSeed(seed);
  const palette = PALETTES[normalizedSeed % PALETTES.length];
  const route = ROUTES[normalizedSeed % ROUTES.length];
  const coast = COASTS[normalizedSeed % COASTS.length];
  const Icon = ICONS[kind];
  const tilt = `${(normalizedSeed % 17) - 8}deg`;
  const style = {
    '--art-bg': palette.bg,
    '--art-bg-2': palette.bg2,
    '--art-a': palette.a,
    '--art-b': palette.b,
    '--art-c': palette.c,
    '--art-a-soft': palette.aSoft,
    '--art-b-soft': palette.bSoft,
    '--art-c-soft': palette.cSoft,
    '--art-tilt': tilt,
  } as React.CSSProperties;

  return (
    <div
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      className={`trippi-default-art trippi-default-art--${kind} trippi-default-art--${tone} ${className}`}
      role={ariaLabel ? 'img' : undefined}
      style={style}
    >
      <svg className="trippi-default-art__svg" viewBox="0 0 800 500" preserveAspectRatio="none">
        <path className="trippi-default-art__land" d={coast} />
        <path
          className="trippi-default-art__soft-grid"
          d="M96 0V500M244 0V500M392 0V500M540 0V500M688 0V500M0 104H800M0 240H800M0 376H800"
        />
        {CONTOURS.map((d) => (
          <path key={d} className="trippi-default-art__contour" d={d} />
        ))}
        <circle className="trippi-default-art__stamp" cx="642" cy="126" r="70" />
        <circle className="trippi-default-art__stamp trippi-default-art__stamp--small" cx="172" cy="372" r="48" />
        <path className="trippi-default-art__route-shadow" d={route} />
        <path className="trippi-default-art__route" d={route} />
        <path
          className="trippi-default-art__route trippi-default-art__route--secondary"
          d="M122 146 C232 98 310 134 384 188 S526 298 692 210"
        />
        <g className="trippi-default-art__pin" transform="translate(150 322)">
          <circle r="18" />
          <circle r="5" />
        </g>
        <g className="trippi-default-art__pin trippi-default-art__pin--end" transform="translate(650 224)">
          <circle r="20" />
          <circle r="6" />
        </g>
        <g className="trippi-default-art__plane" transform="translate(444 208) rotate(-18)">
          <path d="M-34 2 L34 -10 L10 4 L26 18 L-2 9 L-24 22 L-13 6 Z" />
        </g>
      </svg>
      {icon && (
        <div className="trippi-default-art__icon">
          <Icon />
        </div>
      )}
    </div>
  );
}
