# Polar-Session-KV

Für die Polar-OAuth-Sessions wird Cloudflare KV verwendet. Dadurch hängt die Verbindung nicht von Cross-Site-Cookies zwischen Pages und Worker ab.

```powershell
npx wrangler kv namespace create POLAR_SESSIONS
```

Die ausgegebene ID in `wrangler.jsonc` bei `REPLACE_WITH_KV_NAMESPACE_ID` eintragen und anschließend deployen:

```powershell
npm run deploy
```

Der Browser speichert nur eine zufällige Session-ID in `localStorage`. Der Polar-Access-Token bleibt im KV-Namespace.
