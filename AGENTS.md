# AGENTS.md – Project Context & Development Guidelines

Welcome Agent! Read this document carefully before generating, refactoring, or modifying any code in this repository.

The **codebase is the source of truth**. Keep this file aligned when architecture or shipped features change.

---

## 1. Project Overview & Vision
- **Name:** LaufTrainer (Working Title / PWA)
- **Goal:** A hyper-minimalist, privacy-first, local-first web app (PWA) for endurance athletes (runners/cyclists).
- **Core Value Proposition (shipped vs vision):**
  1. **Shipped:** Import workouts from files (CSV/JSON/TCX/GPX/FIT) and sync via **Polar** and **Strava** OAuth connectors.
  2. **Shipped:** Analyze fitness metrics locally (CTL / ATL / TSB, plus ACWR, Foster, polarization, HR zones, efficiency).
  3. **Shipped:** AI-generated weekly training plans (Gemini via Worker), monetized with a credit wallet (Paddle).
  4. **Not built:** Social-media share cards / GPS route image export with privacy masking.

---

## 2. Core Architecture & Stack
- **Frontend:** Vue 3 (Composition API `<script setup>`), Pinia, Vue Router, Vite PWA.
- **Styling:** Tailwind CSS is available, but the primary UI language is **custom CSS** in `frontend/src/styles.css` plus design tokens. Prefer matching existing patterns over introducing a new styling approach.
- **Local Storage:** Local-first via a **custom IndexedDB wrapper** (`frontend/src/db/database.ts`, DB name `lauftrainer-local`). **Not Dexie.**
  - *CRITICAL:* Athlete health and workout payloads stay on the device.
  - Backend must **not** persist workout/history bodies. It may hold OAuth session tokens (KV), billing/credits (D1), and proxy structured LLM requests.
- **Backend:** Cloudflare Worker (`backend/src/server.ts`, Wrangler), not Express/FastAPI.
- **Data Visualizations:** Chart.js via `vue-chartjs` (`MiniChart.vue`).
- **Maps:** MapLibre + PMTiles (Germany extract on Cloudflare R2, direct Range requests; no Worker in the map path). Workout GPS route overlay is local; Overpass is not used.
- **Billing:** Anonymous wallet + Paddle checkout/webhooks (`/api/billing/*`).

### Main app routes / nav
- Sidebar order: **Dashboard** → **Analysis** → **Settings**
- Also: `/pricing`, `/welcome`, legal pages

### Connectors
- OAuth sync: **`polar`** and **`strava`** only (`ConnectorId`).
- Garmin: **FIT file import** via `@garmin/fitsdk` — no Garmin OAuth connector.
- Soft dedup by activity fingerprint after connector sync; Polar+Strava overlap can still double-count (UI warns when both are connected and active).

---

## 3. UI/UX & Design System Principles

### Aesthetic Direction
- **Vibe:** Ultra-minimalist, "Nordic / Apple-inspired", dark mode default (theme preference: system / light / dark).
- **Design Tone:** Clean, high-density data analytics without visual bloat.

### Color Tokens
- **Background Base:** `#0D1117` (Deep Slate / Dark Charcoal)
- **Card Background:** `#161B22` (Elevated dark card fill)
- **Borders:** `1px solid rgba(255, 255, 255, 0.08)` (subtle zinc borders)
- **Text Primary:** `#F0F6FC` (Off-white)
- **Text Secondary / Labels:** `#8B949E` (Muted gray)
- **Accent Color:** Neon Emerald `#10B981` / Lime `#A3E635` (Use sparingly for active states, positive TSB, primary actions)

### Layout & Component Rules
1. **Maximize Screen Real Estate:** Avoid duplicate page titles or redundant headers. Primary chrome is the **sidebar** (not a sticky bottom nav).
2. **KPIs & Metrics:** ALWAYS use multi-column grids for numeric metrics (Workouts, Distance, TSB). NEVER stack single-number full-width cards vertically.
3. **Typography:** Numbers bold/prominent; category labels small, uppercase, letter-spaced (existing CSS / utility patterns).
4. **Cards:** Minimal padding (`p-3` / `p-4` or equivalent), subtle rounded corners, no heavy drop shadows or bright gradients.

---

## 4. Key Priorities & Tier System

When building or refactoring features, respect the following priority hierarchy:

* **Tier 1 (Core Essentials — keep solid):**
  - IndexedDB local storage & fast reads (`database.ts` / stores).
  - Polar + Strava OAuth & workout ingestion; file import (CSV/JSON/TCX/GPX/FIT).
  - Analysis engine (`analysisEngine.ts`): CTL/ATL/TSB, ACWR, Foster (± RPE), polarization, HR zones, efficiency + Chart.js UI.
  - Structured AI weekly plan generator (JSON from Gemini via Worker) + credits flow.
* **Tier 2 (Growth — partially shipped):**
  - **Shipped:** One-click JSON local backup & restore.
  - **Not built:** GPS canvas share cards; privacy masking (truncate/blur start/end ~500 m of routes).
* **Tier 4 (Anti-Features – DO NOT BUILD):**
  - DO NOT build custom social feeds, workout recording/tracking via device GPS, or video/recipe libraries.

---

## 5. Instructions for Coding Agents
- **Code Style:** Clean, modular Vue 3 components with `<script setup>`.
- **Styling:** Match existing `styles.css` / component patterns. Do not rewrite the UI to “Tailwind-only” unless explicitly asked. Avoid new raw CSS unless needed (e.g. Chart.js plugins).
- **Preserve Logic:** When refactoring UI, preserve reactive state, IndexedDB calls, Pinia stores, and API handlers.
- **Privacy:** Never send raw workout streams or API keys to the frontend; AI calls send condensed summaries only after consent.
- **Error Handling:** Handle API requests defensively (including stream/`response.clone()` cases where used).
- **i18n:** Custom `frontend/src/i18n.ts` (de/en). Add keys to **both** locales when changing copy.
