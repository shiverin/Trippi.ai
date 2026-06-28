// Trip PDF via browser print window
import { buildTripPdfHtml, type TripPdfReservation } from '@trippi/shared';
import { accommodationsApi, mapsApi } from '../../api/client';
import type { AssignmentsMap, Category, Day, DayNote, Place, Trip } from '../../types';

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Pre-fetch place photos for all assigned places.
// Assignment places are a server-side projection that drops osm_id, so we recover
// the full place from the trip's places pool and key the photo off the same id the
// app UI uses (google_place_id || osm_id || coords) — otherwise OSM/coords-only
// places fell back to category icons in the PDF even though they show photos in-app.
async function fetchPlacePhotos(assignments: AssignmentsMap, places: Place[]) {
  const photoMap = {}; // placeId → photoUrl
  // The assignment projection drops osm_id, so recover it from the full places pool.
  const osmById = new Map((places || []).map((p) => [p.id, p.osm_id]));
  const allPlaces = Object.values(assignments)
    .flatMap((a) => a.map((x) => x.place))
    .filter(Boolean);
  const unique = [...new Map(allPlaces.map((p) => [p.id, p])).values()];

  const toFetch = unique
    .map((p) => ({ p, osm_id: osmById.get(p.id) }))
    .filter(({ p, osm_id }) => !p.image_url && (p.google_place_id || osm_id || (p.lat != null && p.lng != null)));

  await Promise.allSettled(
    toFetch.map(async ({ p, osm_id }) => {
      // Same key the app UI uses: google_place_id || osm_id || coords.
      const photoId = p.google_place_id || osm_id || `coords:${p.lat}:${p.lng}`;
      try {
        const data = await mapsApi.placePhoto(photoId, p.lat, p.lng, p.name);
        if (data.photoUrl) photoMap[p.id] = data.photoUrl;
      } catch {}
    })
  );
  return photoMap;
}

interface downloadTripPDFProps {
  trip: Trip;
  days: Day[];
  places: Place[];
  assignments: AssignmentsMap;
  categories: Category[];
  // Flattened across days: each note carries its own day_id (see downloadTripPDF callers).
  dayNotes: DayNote[];
  reservations?: TripPdfReservation[];
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
}

export async function downloadTripPDF({
  trip,
  days,
  places,
  assignments,
  categories,
  dayNotes,
  reservations = [],
  t: _t,
  locale: _locale,
}: downloadTripPDFProps) {
  const loc = _locale || 'en-US';
  const tr = _t || ((k) => k);
  const accommodations = await accommodationsApi.list(trip.id);
  const photoMap = await fetchPlacePhotos(assignments, places);
  const html = buildTripPdfHtml({
    trip,
    days,
    places,
    assignments,
    categories,
    dayNotes,
    reservations,
    accommodations: accommodations.accommodations || [],
    photoMap,
    t: tr,
    locale: loc,
    origin: window.location.origin,
  });

  // Open in modal with srcdoc iframe (no URL loading = no X-Frame-Options issue)
  const overlay = document.createElement('div');
  overlay.id = 'pdf-preview-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:8px;';
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  const card = document.createElement('div');
  card.style.cssText =
    'width:100%;max-width:1000px;height:95vh;background:var(--bg-card);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border-primary);flex-shrink:0;';
  header.innerHTML = `
    <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${escHtml(trip?.title || tr('pdf.travelPlan'))}</span>
    <div style="display:flex;align-items:center;gap:8px">
      <button id="pdf-print-btn" style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;font-family:inherit">${tr('pdf.saveAsPdf')}</button>
      <button id="pdf-close-btn" style="background:none;border:none;cursor:pointer;color:var(--text-faint);display:flex;padding:4px;border-radius:6px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'flex:1;width:100%;border:none;';
  // No script runs inside the document (print is parent-initiated), so withhold
  // allow-scripts to keep the sandbox tight.
  iframe.sandbox = 'allow-same-origin allow-modals';
  iframe.srcdoc = html;

  card.appendChild(header);
  card.appendChild(iframe);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const closeBtn = header.querySelector<HTMLElement>('#pdf-close-btn');
  if (closeBtn) closeBtn.onclick = () => overlay.remove();
  const printBtn = header.querySelector<HTMLElement>('#pdf-print-btn');
  if (printBtn)
    printBtn.onclick = () => {
      iframe.contentWindow?.print();
    };
}
