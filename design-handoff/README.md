# TREK Design Handoff

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

The script starts TREK's existing E2E backend and Vite frontend against a throwaway seeded database. It does not use your real production data.

## Seeded Login

The script uses the existing E2E credentials:

- Email: `e2e@trek.local`
- Initial password: `E2eTest12345!`
- Changed password: `E2eChanged12345!`

