# LaufTrainer App

Lokale Vue-3-PWA für Trainingsimport, Auswertung und KI-Trainingsplanung.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Trainingsdateien werden im Browser verarbeitet und in IndexedDB gespeichert. CSV inklusive Polar-Zeitreihen, JSON und TCX werden unterstützt. Dateien werden per SHA-256 erkannt, sodass dieselbe Datei nicht doppelt importiert wird.

Die lokale Übersicht berechnet bereits Gesamtzeit, Distanz, Wochenwerte, Trainingslast und Herzfrequenz-Zonen. Backups können als JSON exportiert und wieder eingelesen werden.

GPX- und FIT-Dateien werden ebenfalls lokal im Browser verarbeitet. FIT wird über die browserkompatible Garmin FIT SDK dekodiert. Die Rohdaten verlassen den Browser beim Dateiimport nicht.

## KI-Backend (TypeScript)

```powershell
cd backend
npm install
Copy-Item .dev.vars.example .dev.vars
# GEMINI_API_KEY in .dev.vars eintragen
npm run dev
```

Die Projektstruktur ist bewusst getrennt:

```text
lauftrainer-app/
├── frontend/   # Vue 3, TypeScript, Vite, PWA
└── backend/    # Node.js, TypeScript, Express, Gemini API
```

Für die lokale Entwicklung das Frontend auf den lokalen Worker zeigen lassen:

```powershell
$env:VITE_AI_API_URL = 'http://localhost:8787/api'
```

In `backend/.dev.vars` genügt für schnelle UI-Tests:

```text
TRAINING_PLAN_MODE=local
```

Im Modus `local` erstellt der Worker echte Gemini-Pläne ohne Credits. Für zufällige Demo-Pläne ohne Gemini `TRAINING_PLAN_MODE=mock` setzen. Produktionsaufrufe verwenden ohne diesen lokalen Modus das normale Creditsystem. `GEMINI_API_KEY` bleibt ausschließlich im Backend.

Das Backend speichert keine Trainingsdaten dauerhaft. Der Gemini-Key darf niemals im Frontend hinterlegt werden.

### Cloudflare Worker Deployment

```powershell
cd backend
npm run build
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

Das Backend ist ein stateless Node-/TypeScript-Service. Die Endpunkte `/health` und `/api/training-plan` bleiben gegenüber der Vue-App unverändert.
