# AAELink Desktop

Native desktop client (Electron) for the AAELink Enterprise SuperApp.
The desktop app is a thin shell that connects to a running AAELink server
(self-hosted via Docker Compose).

## Configure server URL

On first run the app reads `AAELINK_SERVER_URL` from the environment. After
launch, the URL is persisted at the OS-specific user-data path:

- macOS: `~/Library/Application Support/AAELink/config.json`
- Windows: `%APPDATA%\AAELink\config.json`
- Linux: `~/.config/AAELink/config.json`

Use **File → Configure Server URL…** to open the file in your file manager,
edit `serverUrl`, then **Retry** from the prompt.

Example:

```json
{ "serverUrl": "http://192.168.1.42:18080" }
```

## Develop

```bash
cd desktop
npm install
AAELINK_SERVER_URL=http://localhost:18080 npm start
```

## Build

```bash
npm run dist:mac    # macOS .dmg (x64 + arm64)
npm run dist:win    # Windows NSIS installer (x64)
```

Releases are built and published automatically by `.github/workflows/release.yml`
when a tag matching `v*` is pushed.
