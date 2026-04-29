# AAELink desktop (test shell)

This is a small **Electron** window that opens your **AAELink** Next.js web UI. By default it loads **`http://localhost:3040`**, matching **`npm run dev`** in the repo root (`next dev -p 3040`) so you do not accidentally open another stack on **:3000** (for example Grafana). It does not bundle Postgres; data stays on whatever host runs your database and `docker compose` for supporting services.

**Dock name “AAELink” (macOS):** While you run **`npm start`** (`electron .`), the Dock **hover label stays “Electron”** — macOS reads that from the generic Electron binary, not from our code. To get **AAELink** in the Dock (and the same icon), run the **unpacked .app** instead:

```bash
# From repo root (builds dist/…/AAELink.app on first run if missing, then opens it)
npm run desktop:start:branded
```

Optional URL override: `AAELINK_DESKTOP_URL=http://127.0.0.1:3040 npm run desktop:start:branded`

The **window title**, **menu bar**, and **About** panel already say **AAELink** with either launcher. `ELECTRON_OVERRIDE_APP_NAME=AAELink` on `npm start` helps some OS surfaces but not the Dock hover.

Installer **version** matches `package.json` in this folder (aligned with the main app release line, for example `0.0.2-alpha`). The app **icon** is `resources/icon.png` (must be a **real PNG**; `electron-builder` turns it into `icon.icns`). After changing the web logo, run **`npm run icons:sync --prefix desktop`** (macOS `sips`) then **`npm run pack --prefix desktop`** so the Dock / window icon updates. If you still see Grafana, the shell is loading the wrong origin: confirm **`npm run dev`** in the parent folder is on **http://localhost:3040** (default), then **`npm run pack --prefix desktop`** so the bundled `main.js` matches, or launch with **`AAELINK_DESKTOP_URL=http://127.0.0.1:3040 npm run desktop:start:branded`**.

For LAN deployment and bootstrap admin, see [`../docs/LAN-DESKTOP-CLIENTS.md`](../docs/LAN-DESKTOP-CLIENTS.md). From the repo root you can create the platform super-admin with `npm run seed:platform-admin` (requires `DATABASE_URL` and `AAELINK_SEED_ADMIN_PASSWORD`). Full stack context: [`../docs/architecture-technical.md`](../docs/architecture-technical.md), [`../docs/WHERE-IS-THE-ENGINE.md`](../docs/WHERE-IS-THE-ENGINE.md).

## IT contact OTP (optional)

The web app can send sign-in verification codes for the IT contact flow. For local development without [Resend](https://resend.com), set `AAELINK_OTP_LOG_TO_STDOUT=1` on the **Next.js** process (see `../.env.example` in the repo root). The desktop shell only loads the URL; it does not send mail.

## Default URL

`http://localhost:3040` — matches **`npm run dev`** in the parent `AAELink/` folder. Override when your Next server uses another host or port:

```bash
# macOS / Linux
AAELINK_DESKTOP_URL=http://192.168.1.10:3040 npm run start

# Windows (cmd)
set AAELINK_DESKTOP_URL=http://192.168.1.10:3040
npm run start
```

Or pass a flag (after install / from unpacked app, use the real executable name shown by your OS):

```text
AAELink --url=http://HOST:3040
```

### HTTPS (temporary host / same Wi‑Fi)

When the Next server is **`https://HOST:3040`** (for example **`npm run dev:wifi:https`** on the host), the desktop must load that URL. Self-signed dev certificates are not trusted by Electron unless you opt in:

```bash
# macOS / Linux — lab / trusted LAN only
AAELINK_DESKTOP_URL=https://192.168.1.10:3040 AAELINK_DESKTOP_TRUST_DEV_TLS=1 npm run start
```

```bat
REM Windows cmd
set AAELINK_DESKTOP_URL=https://192.168.1.10:3040
set AAELINK_DESKTOP_TRUST_DEV_TLS=1
npm run start
```

From the repo root on the host Mac: **`npm run desktop:start:wifi:https`** sets both variables. Prefer installing the **mkcert** root CA on clients instead of `AAELINK_DESKTOP_TRUST_DEV_TLS` when you can. Never enable `AAELINK_DESKTOP_TRUST_DEV_TLS` for arbitrary internet hosts.

## Local build

From repo root:

```bash
npm run desktop:install
npm run desktop:build:mac    # on macOS → desktop/dist/*.dmg
npm run desktop:build:win    # on Windows → desktop/dist/AAELink-Setup-<version>.exe
```

macOS DMGs must be built on **macOS**. Windows **x64** NSIS installers can be built on **macOS** from the repo root with `npm run desktop:build:win` (uses `electron-builder --x64`) or on **Windows** / **GitHub Actions**.

The default DMG on Apple Silicon is **arm64** (for example `AAELink-0.1.0-arm64.dmg`). For **Intel Macs**, run `npx electron-builder --mac dmg --x64` from `desktop/` after `npm ci` (or add a CI job), then distribute that DMG separately.

## Auto-updates (packaged app)

The **installed** desktop shell (not `electron .` from source) checks **GitHub Releases** for this repository on a short delay after launch and about every **4 hours**. New versions download in the background and apply on the **next quit** (no extra installer run).

Requirements for updates to work:

1. **`repository.url`** and **`build.publish`** in `desktop/package.json` must point at the GitHub repo that hosts releases (forks: change `repository` before building).
2. Publish a **GitHub Release** whose tag is a valid semver (for example `v0.0.2-alpha`) and attach **`desktop/dist/latest.yml`** and **`desktop/dist/AAELink-Setup-<version>.exe`** from a `dist:win` build with the **same** `desktop/package.json` **version** as in `latest.yml`. Without `latest.yml` on the release, the client cannot detect updates.
3. Optional: set **`AAELINK_UPDATES_BASE_URL`** to the HTTPS folder that contains `latest.yml` (generic feed) instead of GitHub.
4. Disable checks: **`AAELINK_DISABLE_UPDATES=1`**. Verbose log: **`AAELINK_UPDATER_DEBUG=1`**. Client log file: **`updater.log`** under the app user-data directory.

## Downloadable builds (CI)

Push changes under `desktop/` to `main`, or run workflow **Desktop build** manually in the GitHub **Actions** tab. Download **artifacts**:

- `aaelink-desktop-macos-dmg` — `.dmg` for Mac testers  
- `aaelink-desktop-windows-setup` — NSIS **Setup** `.exe` for Windows testers  

## Firewall

If a Windows PC loads the app pointed at your Mac, the Mac must allow inbound traffic on the port your Next server uses (default dev **3040**); see `../docs/HOSTING-MACBOOK.md` if you proxy or tunnel.
