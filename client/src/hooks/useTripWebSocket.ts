import { useEffect } from 'react';
import { addListener, joinTrip, leaveTrip, removeListener } from '../api/websocket';
import { useTripStore } from '../store/tripStore';
import type { WebSocketEvent } from '../types';

export function useTripWebSocket(tripId: number | string | undefined) {
  const tripStore = useTripStore();

  useEffect(() => {
    if (!tripId) return;
    const handler = useTripStore.getState().handleRemoteEvent;
    joinTrip(tripId);
    addListener(handler);
    const collabFileSync = (event: WebSocketEvent) => {
      if (event?.type === 'collab:note:deleted' || event?.type === 'collab:note:updated') {
        tripStore.loadFiles?.(tripId);
      }
    };
    addListener(collabFileSync);
    const localFileSync = () => tripStore.loadFiles?.(tripId);
    window.addEventListener('collab-files-changed', localFileSync);
    return () => {
      leaveTrip(tripId);
      removeListener(handler);
      removeListener(collabFileSync);
      window.removeEventListener('collab-files-changed', localFileSync);
    };
  }, [tripId]);
}
