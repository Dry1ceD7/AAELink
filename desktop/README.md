# AAELink Desktop

Native desktop client (Electron) for the AAELink Enterprise SuperApp. The
desktop app is a thin shell that connects to the centralized AAELink server
running on the shared office network.

## Centralized server URL

Every AAELink desktop installation on the same Wi-Fi network must point at
the same backend so users share a single database, ticket queue, and file
store. The current temporary deployment is hosted on the team MacBook via
Docker Desktop.

Default server URL (compiled in):

```
http://192.168.11.73:18080
```

Override by setting `AAELINK_SERVER_URL` before launching, or by editing the
persisted config:

- macOS: `~/Library/Application Support/AAELink/config.json`
- Windows: `%APPDATA%\AAELink\config.json`
- Linux: `~/.config/AAELink/config.json`

```json
{ "serverUrl": "http://192.168.11.73:18080" }
```

Use **File → Configure Server URL…** to open the file in your file manager,
edit `serverUrl`, then **Retry** from the prompt. To find the host MacBook's
current LAN address, run on the host:

```bash
ipconfig getifaddr en0   # Wi-Fi
ipconfig getifaddr en1   # Wired
```

## Default super-admin

The auth service idempotently provisions a documented super-administrator
account on every start (and removes any legacy admin rows). Use it for
first-time login and customer trials:

| Field    | Value                          |
| -------- | ------------------------------ |
| Username | `Adminaaelink`                 |
| Password | `Adminaaelink2026`             |
| Email    | `Adminaaelink@aae.co.th`       |

The login screen accepts either the bare username or the full email — bare
usernames are auto-completed to the configured tenant domain
(`SUPER_ADMIN_DOMAIN`, default `aae.co.th`).

## Verifying connectivity from another PC

`ping` only checks ICMP and **does not test HTTP ports**. Use one of the
following from the secondary PC instead:

PowerShell (Windows):

```powershell
Test-NetConnection -ComputerName 192.168.11.73 -Port 18080
```

Bash / zsh (macOS, Linux, WSL):

```bash
curl -v http://192.168.11.73:18080/
```

If neither works:

1. **Docker port binding** — confirm Traefik publishes on `0.0.0.0`:

   ```bash
   docker port aaelink-traefik
   # expect: 80/tcp -> 0.0.0.0:18080
   ```

2. **macOS firewall** — make sure the Application Firewall is off or has an
   exception for Docker:

   ```bash
   /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
   # expect: Firewall is disabled. (State = 0)
   ```

3. **Wi-Fi AP isolation** — many guest / hotel SSIDs block client-to-client
   traffic. Toggle off "AP Isolation" / "Client Isolation" in the router or
   move both machines to a non-isolated network.

## Develop

```bash
cd desktop
npm install
AAELINK_SERVER_URL=http://192.168.11.73:18080 npm start
```

## Build native installers

```bash
npm run dist:mac    # macOS .dmg (x64 + arm64)
npm run dist:win    # Windows NSIS installer (x64)
```

Releases are built and published automatically by `.github/workflows/release.yml`
when a tag matching `v*` is pushed.
