import { useEffect, useState } from 'react';
import { mapsApi } from '../api/client';
import type { MapsMapboxSessionResult } from '@trippi/shared';

type MapboxSessionState =
  | { status: 'idle' | 'loading'; session: null; error: null }
  | { status: 'ready'; session: MapsMapboxSessionResult; error: null }
  | { status: 'fallback'; session: MapsMapboxSessionResult | null; error: Error | null };

export function useMapboxSession(enabled: boolean, style?: string | null): MapboxSessionState {
  const [state, setState] = useState<MapboxSessionState>({ status: enabled ? 'loading' : 'idle', session: null, error: null });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', session: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', session: null, error: null });
    mapsApi
      .mapboxSession(style || undefined)
      .then((session) => {
        if (cancelled) return;
        setState(session.enabled && session.styleUrl ? { status: 'ready', session, error: null } : { status: 'fallback', session, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'fallback', session: null, error: err instanceof Error ? err : new Error('Mapbox unavailable') });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, style]);

  return state;
}
