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

## KI-Backend (TypeScript)

```powershell
cd backend
npm install
$env:GEMINI_API_KEY = '...'
npm run dev
```

Die Projektstruktur ist bewusst getrennt:

```text
lauftrainer-app/
├── frontend/   # Vue 3, TypeScript, Vite, PWA
└── backend/    # Node.js, TypeScript, Express, Gemini API
```

Für die lokale Entwicklung: `$env:VITE_AI_API_URL = 'http://localhost:8000/api'` vor `npm run dev` setzen.

Das Backend speichert keine Trainingsdaten dauerhaft. Der Gemini-Key darf niemals im Frontend hinterlegt werden.

### Produktionsbuild / Docker

```powershell
cd backend
npm run build
docker build -t lauftrainer-backend .
docker run --rm -p 8000:8000 -e GEMINI_API_KEY='...' lauftrainer-backend
```

Das Backend ist ein stateless Node-/TypeScript-Service. Die Endpunkte `/health` und `/api/training-plan` bleiben gegenüber der Vue-App unverändert.
