# trippi.ai Design Handoff

This folder packages the current frontend into Figma-friendly source material for designers.

## What This Gives Designers

- Screen inventory for the app routes and major views.
- Runtime screenshots at desktop and mobile sizes.
- Extracted visual tokens from the live app, including CSS custom properties and font stack.
- A repeatable capture script so the handoff can be refreshed after frontend changes.

## Figma Workflow

The most practical path is:

1. Run the capture script to generate fresh PNG references and token JSON.
2. Import screenshots into Figma as visual references.
3. Build reusable Figma components from the component catalog and token JSON.
4. Recreate priority screens as editable Figma frames using Auto Layout.
5. Keep screenshots beside editable frames as truth references during iteration.

Direct code-to-Figma export is not fully automatic for this repo because it does not currently contain Figma Code Connect files or Figma component mappings. If a Figma connector is available later, this package can be used as the input for creating editable frames in Figma.

## Run

From the repo root:

```bash
node design-handoff/scripts/capture-screens.mjs
```

Outputs are written to:

- `design-handoff/screens/`
- `design-handoff/tokens/runtime-tokens.json`
- `design-handoff/capture-manifest.json`

The script starts trippi.ai in demo mode against a throwaway seeded database, then opens the live Vite app and captures the rendered screens. It does not use your real production data.

By default the capture backend runs on port `3101` so it does not collide with the normal local API server. The capture run also sets `TRIPPI_DISABLE_OVERLAYS=true` and `VITE_TRIPPI_DISABLE_OVERLAYS=true` so demo/system notice popups stay out of design references.

## Seeded Login

The script uses the demo-mode admin user:

- Email: `admin@trippi.app`
- Password: `admin12345`

## Captured Screens

The current handoff set includes:

- Desktop: login, demo dashboard, trip planner, trip costs, trip files, Vacay, Atlas, admin.
- Mobile: dashboard, trip planner, Vacay, Atlas.

Map-based screens wait for rendered Leaflet tiles before screenshotting so the map background is visible in the saved PNGs.

## Useful Overrides

```bash
TRIPPI_CAPTURE_BACKEND_PORT=3101 \
TRIPPI_CAPTURE_BASE_URL=http://localhost:5173 \
TRIPPI_CAPTURE_TRIP_ID=3 \
node design-handoff/scripts/capture-screens.mjs
```

The default trip id is `3`, the seeded New York City trip, so the planner map captures focus on city-scale pins. The New York dashboard cover is stored locally at `client/public/demo/new-york-cover.jpg`; source: Wikimedia Commons `Brooklyn Bridge, New York City, United States (Unsplash).jpg`, CC0.
