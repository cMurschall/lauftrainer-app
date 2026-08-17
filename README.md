# LaufTrainer App

Lokale Vue-3-PWA für Trainingsimport, Auswertung und KI-Trainingsplanung.

```text
lauftrainer-app/
├── frontend/   # Vue 3, Pinia, Vue Router, Vite PWA, Chart.js
└── backend/    # Cloudflare Worker (Wrangler), Gemini, Polar/Strava OAuth, Paddle/D1
```

Der Code ist die Quelle der Wahrheit. Trainingsrohdaten bleiben im Browser (IndexedDB); das Backend speichert keine Workout-Historie.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Optional gegen einen lokalen Worker:

```powershell
$env:VITE_AI_API_URL = 'http://localhost:8787/api'
npm run dev
```

### Was lokal passiert

- Dateiimport: CSV (inkl. Polar-Zeitreihen), JSON, TCX, GPX, FIT (`@garmin/fitsdk`). Rohdaten verlassen den Browser beim Import nicht.
- Dedup: SHA-256 für Dateien; zusätzliche Aktivitäts-Fingerprints nach Connector-Sync.
- Speicherung: Custom IndexedDB (`frontend/src/db/database.ts`), nicht Dexie.
- Analyse u. a.: Wochenvolumen, CTL/ATL/TSB, ACWR, Foster (± RPE), 3-Zonen-Polarisation, 5-HR-Zonen, Laufeffizienz.
- Backup: JSON exportieren / wiederherstellen in den Einstellungen.
- Navigation: Dashboard → Analysen → Einstellungen (Sidebar); Credits unter `/pricing`.

### Frontend deploy (Cloudflare Pages)

```powershell
cd frontend
npm run deploy
```

### Basemap (PMTiles on R2)

Route previews use MapLibre + a Germany vector basemap served as a single PMTiles archive from Cloudflare R2 (direct Range requests, no Worker in the map path).

1. Install the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles/releases).
2. Extract Germany (about once a month):

```powershell
.\scripts\extract-germany-pmtiles.ps1 -SourceDate 20260815 -MaxZoom 12
```

3. Create an **R2 Standard** bucket (not Infrequent Access). Upload `germany.pmtiles`.
4. CORS on the bucket (adjust origins to your Pages URL):

```json
[
  {
    "AllowedOrigins": [
      "https://lauftrainer-app.pages.dev",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "If-Match", "if-match", "range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Accept-Ranges"],
    "MaxAgeSeconds": 86400
  }
]
```

5. Enable a public bucket URL or custom domain, then set in the Pages build env / local `.env`:

```text
VITE_MAP_PMTILES_URL=https://<your-maps-host>/germany.pmtiles
```

Without that URL (or with map consent denied / routes outside Germany), the UI shows the GPS route only.

## Backend (Cloudflare Worker)

```powershell
cd backend
npm install
# Secrets/Vars lokal in .dev.vars (Datei selbst anlegen, kein .dev.vars.example im Repo)
# Mindestens z. B.:
#   GEMINI_API_KEY=...
#   TRAINING_PLAN_MODE=local
# Optional: POLAR_*, STRAVA_CLIENT_SECRET, PADDLE_*
npm run dev
```

`npm run dev` wendet lokale D1-Migrationen an und startet Wrangler (typisch Port `8787`).
Im Modus `TRAINING_PLAN_MODE=local` wird jeder Gemini-Aufruf zusätzlich als eigene JSON-Datei mit Request und Response unter `backend/output/gemini/` gespeichert.

### Modi

| `TRAINING_PLAN_MODE` | Verhalten |
|----------------------|-----------|
| unset / production   | Credits + Gemini |
| `local`              | Gemini-Pläne ohne Credits (UI/Dev) |
| `mock`               | Demo-Pläne ohne Gemini |

`GEMINI_API_KEY` bleibt ausschließlich im Backend.

### Wichtige Endpunkte

- `GET /health`
- `POST /api/training-plan`
- Connectoren: `/api/connectors/*`, legacy Polar unter `/api/polar/*`
- Billing: `/api/billing/*` (Wallet, Balance, Checkout, Webhook, …)

OAuth-Tokens liegen in Cloudflare KV (`POLAR_SESSIONS`, auch für Strava-Sessions). Credits/Billing in D1 (`lauftrainer-billing`). Details: `backend/POLAR_KV_SETUP.md`.

### Worker deploy

```powershell
cd backend
npm run build
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
# weitere Secrets nach Bedarf (Polar/Strava/Paddle)
npm run deploy
```

Bindings (KV, D1) stehen in `backend/wrangler.jsonc`.
