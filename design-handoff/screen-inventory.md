# TREK Screen Inventory

Source: `client/src/App.tsx`

## Public Screens

| Route | Screen | Notes |
| --- | --- | --- |
| `/login` | Login | Also used by `/register` route in `App.tsx`. |
| `/register` | Login/Register mode | Same page component as login. |
| `/forgot-password` | Forgot password | Public recovery flow. |
| `/reset-password` | Reset password | Public recovery flow. |
| `/shared/:token` | Shared trip | Public shared itinerary. Needs token data to capture accurately. |
| `/public/journey/:token` | Public journey | Public memory/journey page. Needs token data to capture accurately. |
| `/oauth/consent` | OAuth consent | Public OAuth approval route. Needs OAuth params to capture accurately. |

## Authenticated Screens

| Route | Screen | Priority |
| --- | --- | --- |
| `/dashboard` | Dashboard / trips list | High |
| `/trips/:id` | Trip planner | High |
| `/trips/:id/files` | Trip files | High |
| `/settings` | Settings | Medium |
| `/admin` | Admin | Medium |
| `/vacay` | Vacation planning | Medium |
| `/atlas` | Atlas map | Medium |
| `/journey` | Journey list | Medium |
| `/journey/:id` | Journey detail | Medium |
| `/notifications` | In-app notifications | Low |

## Key Component Areas

| Area | Source Folder |
| --- | --- |
| Layout shell, navbar, mobile nav | `client/src/components/Layout` |
| Trip planner | `client/src/components/Planner` |
| Maps | `client/src/components/Map` |
| Dashboard trips | `client/src/components/Trips`, `client/src/pages/dashboard` |
| Files | `client/src/pages/files`, `client/src/pages/FilesPage.tsx` |
| Settings | `client/src/components/Settings` |
| Budget / costs | `client/src/components/Budget` |
| Packing | `client/src/components/Packing` |
| Journey | `client/src/components/Journey` |
| Shared primitives | `client/src/components/shared` |

## Design System Notes

- Fonts are defined in `client/src/index.css`.
- Tailwind semantic color aliases are defined in `client/tailwind.config.js`.
- The app uses CSS custom properties for light and dark themes.
- Icons come primarily from `lucide-react`.
- There are no `*.figma.ts(x)` Code Connect files currently present.

