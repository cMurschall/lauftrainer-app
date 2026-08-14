# Connector-Session-KV (`POLAR_SESSIONS`)

OAuth-Sessions für **Polar** und **Strava** liegen in Cloudflare KV (Binding-Name historisch: `POLAR_SESSIONS`). So hängt die Verbindung nicht von Cross-Site-Cookies zwischen Pages und Worker ab.

## Keys (Ist)

| Prefix | Zweck |
|--------|--------|
| `oauth-state:…` / `strava-oauth-state:…` | Kurzlebiger OAuth-`state` |
| `polar-session:…` | Polar-Token-JSON |
| `strava-session:…` | Strava-Token-JSON |

Der Browser speichert nur eine zufällige Session-ID in `localStorage`. Access-/Refresh-Tokens bleiben im KV.

## Namespace anlegen / binden

Falls noch kein Namespace existiert:

```powershell
cd backend
npx wrangler kv namespace create POLAR_SESSIONS
```

Die ausgegebene ID in `wrangler.jsonc` unter `kv_namespaces` → Binding `POLAR_SESSIONS` eintragen (im Repo bereits gesetzt) und deployen:

```powershell
npm run deploy
```

Redirect-URIs und Client-IDs stehen in `wrangler.jsonc` / Secrets (`POLAR_CLIENT_*`, `STRAVA_CLIENT_SECRET`, …).
