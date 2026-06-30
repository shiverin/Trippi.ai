<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/trippi-wordmark-light.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/trippi-wordmark.png" />
  <img src="docs/brand/trippi-wordmark.png" alt="trippi.ai" width="320" />
</picture>

<br />

<p><strong>Cloud group travel planning, built for collaboration and AI.</strong></p>

<p>
  <a href="https://trippi.ai/">trippi.ai</a> is a hosted travel workspace for friends, families, and teams who want
  one shared place to turn ideas into itineraries, maps, budgets, reservations, and decisions.
</p>

<p>
  No more jumping between maps, notes, booking emails, spreadsheets, and group chats. Plan together in real time
  with interactive maps, drag-and-drop itineraries, route planning, polls, shared documents, expense tracking, and
  trip history that stays organized as plans change.
</p>

<p>
  Connect AI assistants through trippi.ai's OAuth-secured MCP layer, so ChatGPT, Claude, Gemini, and future agent
  workflows can research options, update trips, and automate travel admin with your permission.
</p>

<p>
  trippi.ai's direction is cloud-first: collaborative trips, AI-assisted planning, and subscription plans for hosted
  storage, premium automation, and shared workspaces.
</p>

<p>From first idea to final boarding pass, keep the whole trip in one place.</p>

<br />

---

<div align="center">

<img src="docs/screenshots/berlin/dashboard.png" alt="trippi.ai dashboard" width="100%" />

</div>

<br />

<div align="center">
  <a href="docs/screenshots/berlin/dashboard.png"><img src="docs/screenshots/berlin/dashboard.png" alt="Dashboard" width="49%" /></a>
  <a href="docs/screenshots/berlin/trip-planner.png"><img src="docs/screenshots/berlin/trip-planner.png" alt="Trip planner with 3D map" width="49%" /></a>
  <a href="docs/screenshots/berlin/journey.png"><img src="docs/screenshots/berlin/journey.png" alt="Journey journal" width="49%" /></a>
  <a href="docs/screenshots/berlin/budget.png"><img src="docs/screenshots/berlin/budget.png" alt="Costs · expense splitting" width="49%" /></a>
  <a href="docs/screenshots/berlin/atlas.png"><img src="docs/screenshots/berlin/atlas.png" alt="Atlas · visited countries" width="49%" /></a>
  <a href="docs/screenshots/berlin/vacay.png"><img src="docs/screenshots/berlin/vacay.png" alt="Vacay planner" width="49%" /></a>
  <a href="docs/screenshots/berlin/trip-iceland.png"><img src="docs/screenshots/berlin/trip-iceland.png" alt="Trip planner · day plan and route" width="49%" /></a>
  <a href="docs/screenshots/berlin/admin.png"><img src="docs/screenshots/berlin/admin.png" alt="Admin panel" width="49%" /></a>
</div>

---

## What you get

<picture>
  <source media="(max-width: 700px)" srcset="docs/tiles/grid-mobile.svg" />
  <img src="docs/tiles/grid-desktop.svg" alt="trippi.ai feature tiles" width="100%" />
</picture>

<details>
<summary><b>See all features</b></summary>

<table>
<tr>
<td width="50%" valign="top">

#### 🧭 Trip planning

- **Drag & drop planner** — organise places into day plans with reordering and cross-day moves
- **Interactive map** — Leaflet or Mapbox GL with 3D buildings, terrain, photo markers, clustering, route visualization
- **Place search** — Google Places with photos, ratings, and hours, plus OpenStreetMap coverage
- **Place import** — shared Google Maps / Naver Maps lists, plus GPX and KML/KMZ/GeoJSON map files
- **Day notes** — timestamped, icon-tagged notes with drag-and-drop reordering
- **Route optimisation** — auto-sort places and export to Google Maps
- **Weather forecasts** — 16-day forecasts via Open-Meteo + historical climate fallback
- **Category filter** — show only matching pins on the map

</td>
<td width="50%" valign="top">

#### 🧳 Travel management

- **Reservations** — flights, accommodations, restaurants with status, confirmation numbers, files; import from booking confirmation emails and PDFs ([KDE Itinerary](https://invent.kde.org/pim/kitinerary))
- **Costs** — track and split trip expenses (Splitwise-style): per-person / per-day breakdowns, settle-up, multi-currency
- **Packing lists** — categories, templates, user assignment, progress tracking
- **Bag tracking** — optional weight tracking with iOS-style distribution
- **Document manager** — attach docs, tickets, PDFs to trips / places / reservations (≤ 50 MB each)
- **PDF export** — full trip plan as PDF with cover page, images, notes

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### 👥 Collaboration

- **Real-time sync** — changes appear instantly across all connected trip members
- **Multi-user trips** — invite members with role-based access
- **Invite links** — one-time or reusable links with expiry
- **SSO (OIDC)** — Google, Apple, and workspace identity providers
- **2FA** — TOTP + backup codes
- **Passkeys** — passwordless WebAuthn login (fingerprint / face / PIN / security key), workspace-configurable
- **Collab suite** — group chat, shared notes, polls, day check-ins

</td>
<td width="50%" valign="top">

#### 📱 Mobile & PWA

- **Installable** — iOS and Android, straight from the browser
- **Offline support** — Service Worker caches tiles, API, uploads via Workbox
- **Native feel** — fullscreen standalone, themed status bar, splash screen
- **Touch optimised** — mobile-specific layouts with safe-area handling

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### 🧩 Workspace modules

- **Lists** — packing lists + to-dos with templates, member assignments, optional bag tracking
- **Costs** — expense tracker with splits and settle-up (who owes whom), multi-currency
- **Documents** — file attachments on trips, places, and reservations
- **Collab** — chat, notes, polls, day-by-day attendance
- **Vacay** — personal vacation planner with calendar, 100+ country holidays, carry-over tracking
- **Atlas** — world map of visited countries, bucket list, travel stats, streak tracking, liquid-glass UI
- **Journey** — magazine-style travel journal with entries, connected photos, maps, moods
- **AirTrail** — connect AirTrail flight data to import and sync flights into reservations
- **MCP** — connect trippi.ai to AI assistants via OAuth 2.1

</td>
<td width="50%" valign="top">

#### 🤖 AI / MCP

- **OAuth-secured MCP layer** — 150+ tools, 30 resources
- **Granular scopes** — 27 OAuth scopes across 13 permission groups
- **Full automation** — AI can create trips, plan days, build packing lists, manage budgets, mark countries visited
- **Pre-built prompts** — `trip-summary`, `packing-list`, `budget-overview`
- **Module-aware** — exposes Atlas, Collab, Vacay when those modules are on

</td>
</tr>
<tr>
<td colspan="2" valign="top">

#### ⚙️ Workspace admin & customisation

- **Dashboard views** — card grid or compact list · **Dark mode** — full theme with matching status bar
- **20 languages** — EN, DE, ES, FR, IT, NL, HU, RU, ZH, ZH-TW, PL, CS, AR (RTL), BR, ID, TR, JA, KO, UK, GR
- **Admin panel** — users, invites, packing templates, categories, modules, and workspace settings
- **Notifications** — per-user preferences across email (SMTP), webhook, ntfy, and an in-app notification center
- **Data controls** — export and backup workflows with retention policies · **Units** — °C/°F, 12h/24h, map tile sources, default coordinates

</td>
</tr>
</table>

</details>

<br />

## License

trippi.ai is licensed under [AGPL v3](LICENSE). See the license file for the complete terms.
