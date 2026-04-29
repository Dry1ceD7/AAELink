# Hosting AAELink on a MacBook (temporary)

**AAELink** = application; **Advanced ID Asia Engineering Co., Ltd.** = company. Use this until the stack runs on a dedicated server. **Site URL** in AAELink must always match the URL users open in the browser.

**Two URLs on one machine:** **`MM_SERVICESETTINGS_SITEURL`** (below) is for the **Mattermost Team Edition** container (often **8065**). The **Next.js** app from this repo is usually **`npm run dev` → `http://localhost:3040`** — different process and env vars (`NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, …). See [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md) and [`architecture-technical.md`](./architecture-technical.md).

## Same Mac only

In `.env`:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:8065
# or
MM_SERVICESETTINGS_SITEURL=http://127.0.0.1:8065
```

Pick one and use it consistently. Mixed use can cause subtle cookie or asset issues.

## Other devices on your LAN (phone, another laptop)

1. On the Mac, find a stable hostname, for example:
   - `scutil --get LocalHostName` (often ends in `.local` via mDNS)
   - or set a fixed name in **System Settings → General → Sharing**
2. Set in `.env`:

```bash
MM_SERVICESETTINGS_SITEURL=http://YOUR-MAC-NAME.local:8065
AAELINK_HTTP_PORT=8065
```

3. Ensure the Mac firewall allows inbound TCP on `AAELINK_HTTP_PORT` for **Docker** (or `com.docker.backend`).

4. Restart the stack: `docker compose up -d` (and re-open the app only via the new Site URL).

## Docker Desktop resources

Give Docker enough RAM and CPUs in **Settings → Resources** so Postgres and the collaboration engine stay stable under load.

## Moving to a server later

1. Plan the public URL (`https://collab.example.com` or similar).
2. Update `MM_SERVICESETTINGS_SITEURL` in production `.env` (or orchestrator secrets) to that URL.
3. Restore or migrate Postgres data using your approved backup/restore procedure.
4. Re-check **System Console → Site URL**, TLS certificates, and reverse-proxy headers (`X-Forwarded-Proto`, WebSockets).
5. Update mobile and desktop clients to the new URL.

## Optional: split DNS or VPN

If you do not want `.local` exposure on the office LAN, use VPN or SSH tunneling instead, and keep Site URL pointing at the tunnel or VPN endpoint users actually hit.

## See also

- [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md) — Docker vs Next.js vs upstream clone  
- [`architecture-technical.md`](./architecture-technical.md) — Next stack map  
- [`deployment/production-checklist.md`](./deployment/production-checklist.md) — TLS, backups, SMTP, and full production gates  
- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices; **Deploy** and **Operations** next steps  
- [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md) — operations layer overview  
- [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) — pinned engine and full phase index  
