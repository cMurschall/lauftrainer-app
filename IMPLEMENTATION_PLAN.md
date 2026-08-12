# Implementierungsplan: LaufTrainer als lokale Vue-PWA

## Ziel

Eine installierbare Vue-3-PWA, die CSV-, JSON- und TCX-Trainingsdateien direkt auf dem iPhone importiert, in IndexedDB speichert und lokal auswertet. Nur die verdichtete Trainingszusammenfassung wird nach ausdrücklicher Zustimmung an ein minimales FastAPI-Backend für den Gemini-Aufruf übertragen.

## Architektur

```text
Dateiimport → Vue/TypeScript → IndexedDB → lokale Analysen/Charts
                                      ↘ Zusammenfassung → FastAPI → Gemini
```

## Umsetzung

- Frontend in `lauftrainer-app` mit Vue 3, TypeScript, Vite und PWA-Unterstützung.
- Lokale Speicherung in IndexedDB mit versioniertem Schema.
- Gemeinsames TypeScript-Workout-Modell für CSV, JSON, TCX und später FIT/GPX.
- Python-Analysen schrittweise nach TypeScript portieren und gegen Referenzwerte prüfen.
- Diagramme direkt in Vue rendern; MRC-/ZWO-Dateien lokal erzeugen.
- Backend in `lauftrainer-app/backend` mit einem einzigen KI-Endpunkt.
- Gemini-Key ausschließlich als Backend-Umgebungsvariable.
- Keine dauerhafte Speicherung von Trainingsdaten im Backend.

## Abnahmekriterien

- Import und lokale Speicherung funktionieren offline auf iPhone Safari.
- Duplikate werden erkannt; Backups können exportiert und wieder importiert werden.
- Analysewerte werden gegen die bestehende Python-Pipeline geprüft.
- Ohne Zustimmung findet kein KI-Aufruf statt.
- Rohdaten und API-Key werden nicht an das Frontend beziehungsweise Backend übertragen.
- PWA ist installierbar und Dashboard auf kleinen Bildschirmen nutzbar.
