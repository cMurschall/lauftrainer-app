# AGENTS.md – Project Context & Development Guidelines

Welcome Agent! Read this document carefully before generating, refactoring, or modifying any code in this repository.

---

## 1. Project Overview & Vision
- **Name:** LaufTrainer (Working Title / PWA)
- **Goal:** A hyper-minimalist, privacy-first, local-first web app (PWA) for endurance athletes (runners/cyclists). 
- **Core Value Proposition:** 
  1. Synchronize/import workouts (Polar, Garmin, Strava).
  2. Analyze fitness metrics locally (CTL, ATL, TSB / Banister Impulse-Response Model).
  3. Offer dynamic, AI-generated weekly training plans (monetized via micro-transactions / credit system).
  4. Generate clean, aesthetic, bloatware-free social media share cards for workouts/routes.

---

## 2. Core Architecture & Stack
- **Frontend Framework:** Vue 3 (Composition API `<script setup>`).
- **Styling:** Tailwind CSS (Utility-first approach).
- **Local Storage Strategy:** Local-First Architecture via **IndexedDB (Dexie.js)**.
  - *CRITICAL:* All sensitive athlete health and workout data stays strictly on the user's device.
  - Backend must remain **stateless** (handling OAuth tokens and proxying structured LLM API requests only).
- **Data Visualizations:** Chart.js (via `vue-chartjs`) for UI charts; HTML5 Canvas for image exports.

---

## 3. UI/UX & Design System Principles

### Aesthetic Direction
- **Vibe:** Ultra-minimalist, "Nordic / Apple-inspired", dark mode default.
- **Design Tone:** Clean, high-density data analytics without visual bloat.

### Color Tokens
- **Background Base:** `#0D1117` (Deep Slate / Dark Charcoal)
- **Card Background:** `#161B22` (Elevated dark card fill)
- **Borders:** `1px solid rgba(255, 255, 255, 0.08)` (subtle zinc borders)
- **Text Primary:** `#F0F6FC` (Off-white)
- **Text Secondary / Labels:** `#8B949E` (Muted gray)
- **Accent Color:** Neon Emerald `#10B981` / Lime `#A3E635` (Use sparingly for active states, positive TSB, primary actions)

### Layout & Component Rules
1. **Maximize Screen Real Estate:** Eliminate duplicate page titles or redundant headers. One clean top bar or sticky bottom navigation.
2. **KPIs & Metrics:** ALWAYS use multi-column grids (e.g. `grid grid-cols-3 gap-2`) for numeric metrics (Workouts, Distance, TSB). NEVER stack single-number full-width cards vertically.
3. **Typography:** Numbers should be bold/prominent (`font-semibold text-xl`). Category labels above numbers must be small, uppercase, and letter-spaced (`text-[10px] uppercase tracking-wider text-zinc-400`).
4. **Cards:** Minimal padding (`p-3` or `p-4`), subtle rounded corners (`rounded-xl`), no heavy drop shadows or bright gradients.

---

## 4. Key Priorities & Tier System

When building or refactoring features, respect the following priority hierarchy:

* **Tier 1 (Core Essentials):**
  - Dexie.js local storage logic & fast reads.
  - Polar/Garmin OAuth & workout ingestion.
  - TSB / CTL / ATL calculation engine & smooth area line charts.
  - Structured AI Weekly Plan generator (JSON output from LLM).
* **Tier 2 (Growth & Quality):**
  - Minimalist GPS canvas exporter (Share Cards).
  - Privacy masking (truncating/blurring start and end 500m of GPS routes).
  - One-click JSON Local Backup & Restore.
* **Tier 4 (Anti-Features – DO NOT BUILD):**
  - DO NOT build custom social feeds, workout recording/tracking via device GPS, or video/recipe libraries.

---

## 5. Instructions for Coding Agents
- **Code Style:** Write clean, modular Vue 3 components with `<script setup>`.
- **Styling:** Use Tailwind utility classes directly in the template. Do not introduce raw custom CSS unless required for Canvas or complex Chart.js gradients.
- **Preserve Logic:** When refactoring UI components, strictly preserve existing reactive state, Dexie.js database calls, and API handlers.
- **Error Handling:** Ensure API requests (especially stream reading like `response.clone()`) are handled defensively.