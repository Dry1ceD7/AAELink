# LAN server and desktop clients

This describes how to run the **AAELink web server** on one machine on your network and install the **desktop shell** on other PCs so they all use the same server.

## Server host (one machine)

1. Install **Node.js 22** and **Docker** (or use your own PostgreSQL 17+).
2. From the repo root, copy `.env.example` to `.env` and adjust `DATABASE_URL` if ports differ.
3. Start dependencies: `docker compose up -d` (Postgres, MinIO, Stirling-PDF as needed).
4. Install and run the app: `npm ci`, `npm run build`, `npm run start` (production) or `npm run dev` (development, port **3040** by default).
5. Open the firewall for the port you expose (default dev **3040**), or put **HTTPS** behind a reverse proxy. Clients must be able to reach `http://HOST:PORT` or `https://HOST`.

### Same Wi‑Fi: other PCs in the browser (development)

- On the host, run **`npm run dev:wifi:auto`** (or `dev:host` / `dev:lan:auto`). That binds **`0.0.0.0:3040`** and sets **`NEXT_PUBLIC_APP_URL`** to `http://<your-LAN-IPv4>:3040` so sign-in cookies and redirects match the URL others use.
- Share the printed URL (**`http://<IPv4>:3040`**) with testers on the **same network**. They open it in Chrome or Edge on their PC.
- **macOS firewall:** allow inbound **Node** or **Terminal** if the page loads blank or assets fail.
- **`NEXT_PUBLIC_APP_URL`** in `.env` should match the origin testers use; the app also derives Next.js **`allowedDevOrigins`** from it so dev assets are not blocked for remote browsers.
- **Production build on LAN:** `npm run build` then **`npm run start:wifi`** (listens on all interfaces). Set **`NEXT_PUBLIC_APP_URL=http://<host-ip>:3040`** before `next start` so the public origin matches (use HTTPS and a real hostname when exposing beyond a trusted LAN).

### Same Wi‑Fi: HTTPS (development, temporary host)

- On the Mac host: **`npm run dev:wifi:https`** (alias **`dev:host:https`**). This runs **`next dev`** on **`0.0.0.0:3040`** with **`--experimental-https`**, and sets **`NEXT_PUBLIC_APP_URL=https://<LAN-IPv4>:3040`** so session cookies use **`Secure`** and redirects match the HTTPS origin.
- **Browsers on other PCs:** open **`https://<IPv4>:3040`**. The first visit shows a certificate warning unless you use trusted certs (see optional mkcert below).
- **Optional mkcert** (same CA on every tester machine, fewer warnings): on the host, `mkcert <LAN-IP>`, then before starting dev:
  - `export AAELINK_HTTPS_KEY=... AAELINK_HTTPS_CERT=...` (and optionally `AAELINK_HTTPS_CA=...` for the root CA)
  - **`npm run dev:wifi:https`** again. Install the mkcert root CA on client PCs per mkcert docs.
- **Desktop shell on other PCs** (installed app) against this HTTPS dev server:
  - **`AAELINK_DESKTOP_URL=https://<host-LAN-IP>:3040`**
  - **`AAELINK_DESKTOP_TRUST_DEV_TLS=1`** — lab only; relaxes TLS verification so Next’s self-signed (or mkcert without CA on the client) works. Do **not** use for production or untrusted hosts.
- **On this Mac** (repo checkout): **`npm run desktop:start:wifi:https`** sets both env vars and starts the desktop against your LAN HTTPS URL.
- Firewall: still **TCP 3040** (HTTPS uses the same port in this dev setup).

If testers are **not** on the same Wi‑Fi (different site, CGNAT), use a tunnel (Tailscale, Cloudflare Tunnel, or similar) and set **`NEXT_PUBLIC_APP_URL`** to that HTTPS origin.

## Desktop installers

- **macOS:** from repo root, `npm run desktop:build:mac` produces `desktop/dist/*.dmg` on a Mac (Apple Silicon by default).
- **Windows:** on a Windows PC, `npm run desktop:build:win` produces `desktop/dist/AAELink-Setup-*.exe`, or use the GitHub Actions workflow **Desktop build** artifacts.

The desktop app is an **Electron** shell that loads the web UI from a URL. It does not bundle the database or the Next.js server.

## Pointing desktops at your server

Default URL is `http://localhost:3040` (same as `npm run dev` in this repo). For other PCs, set one of:

- Environment variable **`AAELINK_DESKTOP_URL`** before starting the app (for example `http://192.168.1.10:3040` or `https://192.168.1.10:3040`).
- Launch argument: **`--url=http://192.168.1.10:3040`** or **`--url=https://…`** (see `desktop/README.md`).

For **HTTPS dev** with a self-signed certificate, set **`AAELINK_DESKTOP_TRUST_DEV_TLS=1`** on the desktop process (lab only). Use **http** only on trusted LANs; prefer **https** when exposed beyond the office or when you want encrypted transport on the LAN.

## First admin account

Bootstrap a platform super-admin (and a default workspace if the user has none) with:

```bash
export AAELINK_SEED_ADMIN_PASSWORD='your-long-password'
npm run seed:platform-admin
```

Optional: `AAELINK_SEED_ADMIN_EMAIL`, `AAELINK_SEED_ADMIN_USERNAME`. Requires `DATABASE_URL` in `.env` and a running Postgres.

## Version alignment

The desktop package version in `desktop/package.json` should match the shipping line for your release (for example `0.0.2-alpha`) so installer filenames and support notes stay consistent.

## See also

- [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md) — Next.js vs optional Mattermost Docker engine  
- [`architecture-ecosystem-map.md`](./architecture-ecosystem-map.md) — hub for technical + parity docs  
- [`desktop/README.md`](../desktop/README.md) — build flags and `--url`
