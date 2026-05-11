"use strict";

/**
 * AAELink Desktop — Main Process entry point.
 *
 * Additions over previous version:
 *  - Single-instance lock  (second launch focuses existing window + relays deep link)
 *  - Hardware-acceleration flags  (GPU rasterization; no CPU fallback)
 *  - aaelink:// deep-link protocol  (packaged + dev argv)
 *  - System tray  (Windows/Linux minimise-to-tray with context menu)
 *  - macOS Dock badge + Windows taskbar overlay badge (unread count)
 *  - before-quit / tray-close guard so Windows users don't accidentally exit
 */

const { app, BrowserWindow, nativeImage, shell, Tray, Menu, ipcMain, powerMonitor } = require("electron");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const { initAutoUpdater }     = require("./main/autoUpdater");
const { registerIpcHandlers } = require("./main/ipcHandlers");
const { setApplicationMenu }  = require("./main/nativeMenu");
const { DEFAULT_APP_ORIGIN }  = require("./shared/constants");
const {
  discoverServerUrl,
  probeUrl,
  saveUrl: saveDiscoveredUrl,
  DEFAULT_PORT: DISCOVERY_PORT,
} = require("./main/discovery");

// ── Hardware acceleration ─────────────────────────────────────────────────────
// Hand off compositing / video decode to the GPU so the renderer never pegs CPU.
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

/**
 * Prefer this machine's Wi‑Fi / same-network IPv4 (RFC1918 first), for dev HTTPS URL.
 * Mirrors `scripts/lan-ipv4-print.zsh` intent without a shell dependency.
 */
function detectPreferredIPv4() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const fam = net.family;
      if (fam !== "IPv4" && fam !== 4) continue;
      if (net.internal) continue;
      out.push(net.address);
    }
  }
  const score = (addr) => {
    const p = String(addr).split(".").map((x) => Number(x));
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return 0;
    const [a, b] = p;
    if (a === 192 && b === 168) return 400;
    if (a === 10) return 300;
    if (a === 172 && b >= 16 && b <= 31) return 200;
    return 100;
  };
  out.sort((x, y) => score(y) - score(x));
  return out[0] || "";
}

function isPrivateOrLocalHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  const p = h.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Unpackaged dev default: same as `npm run dev` (HTTPS on :3040, Wi‑Fi / LAN IP). */
function defaultUnpackagedDevUrl() {
  const ip = detectPreferredIPv4();
  if (!ip) {
    try {
      console.warn(
        "[AAELink] No non-loopback IPv4 found. Using 127.0.0.1 — connect Wi‑Fi or set AAELINK_DESKTOP_URL."
      );
    } catch { /* ignore */ }
  }
  const host = ip || "127.0.0.1";
  return `http://${host}:3040`;
}

function computeStartUrl() {
  const fromEnv = process.env.AAELINK_DESKTOP_URL?.trim();
  if (fromEnv) return fromEnv;
  const arg = process.argv.find((a) => a.startsWith("--url="));
  if (arg) return arg.slice("--url=".length).trim();
  if (!app.isPackaged) return defaultUnpackagedDevUrl();
  // Packaged: DEFAULT_APP_ORIGIN may be blank → show connect page
  return DEFAULT_APP_ORIGIN || "";
}

/**
 * Result of the live discovery used by createWindow().
 * Populated in app.whenReady() before the window is constructed so the
 * cert-trust switch and the load decision both see the same URL.
 */
let __discovery = { url: "", source: "pending", detectedIp: "" };

async function runDiscovery() {
  try {
    const r = await discoverServerUrl({ app, argv: process.argv, env: process.env });
    __discovery = r;
    if (r.url) {
      try {
        console.log(`[AAELink] discovered server: ${r.url} (source=${r.source})`);
      } catch { /* ignore */ }
    } else {
      try {
        console.warn(
          `[AAELink] no server reachable on this WiFi (detected IP: ${r.detectedIp || "?"}). ` +
          "Falling back to connect screen."
        );
      } catch { /* ignore */ }
    }
  } catch (e) {
    try { console.error("[AAELink] discovery failed:", e?.message || e); } catch { /* ignore */ }
    __discovery = { url: "", source: "error", detectedIp: "" };
  }
}

// Dev / lab: trust Next.js experimental HTTPS (self-signed) on private IPs / localhost.
// Opt out: AAELINK_DESKTOP_TRUST_DEV_TLS=0. Force on: AAELINK_DESKTOP_TRUST_DEV_TLS=1.
function shouldIgnoreCertificateErrors(startUrl) {
  if (process.env.AAELINK_DESKTOP_TRUST_DEV_TLS === "0") return false;
  if (process.env.AAELINK_DESKTOP_TRUST_DEV_TLS === "1") return true;
  if (app.isPackaged) return false;
  try {
    const u = new URL(startUrl);
    if (u.protocol !== "https:") return false;
    return isPrivateOrLocalHost(u.hostname);
  } catch {
    return false;
  }
}

// Cert-trust switch must be set before app.whenReady(). We can't await
// discovery here, but we can be conservative: if the user provided an
// explicit URL we honor it; otherwise we trust private-IP HTTPS in dev (the
// detected URL will also be private). Discovery runs at whenReady().
const __startUrlForCertSwitch = computeStartUrl() || "https://192.168.0.0:3040";
if (shouldIgnoreCertificateErrors(__startUrlForCertSwitch)) {
  app.commandLine.appendSwitch("ignore-certificate-errors");
}

// ── App identity ──────────────────────────────────────────────────────────────
app.setName("AAELink");

// ── Custom protocol registration ──────────────────────────────────────────────
// aaelink://workspace/<id>/channel/<id>  →  deep-link navigation
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("aaelink", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("aaelink");
}

// ── Single-instance lock ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** Accumulated unread-mention count surfaced by the renderer. */
let globalBadgeCount = 0;
/** Set to true before app.quit() so the close-guard lets the window actually close. */
app.isQuiting = false;

// ── Window bounds persistence ─────────────────────────────────────────────────
const BOUNDS_FILE = path.join(app.getPath("userData"), "window-bounds.json");

function loadWindowBounds() {
  try {
    if (fs.existsSync(BOUNDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BOUNDS_FILE, "utf-8"));
      if (data && typeof data.width === "number" && typeof data.height === "number") {
        return { width: data.width, height: data.height, x: data.x, y: data.y };
      }
    }
  } catch { /* ignore */ }
  return null;
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify(bounds), "utf-8");
  } catch { /* ignore */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveWindowIcon() {
  const p = path.join(__dirname, "..", "resources", "icon.png");
  try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  return undefined;
}

function applyDockIcon(iconPath) {
  if (process.platform !== "darwin" || !iconPath) return;
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) app.dock.setIcon(img);
  } catch { /* ignore */ }
}

function resolveStartUrl() {
  // Prefer the live discovery result. Falls back to the static computation
  // (env/arg/dev-IP/blank) only if discovery hasn't run or returned nothing.
  if (__discovery && __discovery.url) return __discovery.url;
  return computeStartUrl();
}

/** Extract the first aaelink:// URL from an argv array (Windows/Linux activation). */
function extractDeepLink(argv) {
  return argv.find((a) => a.startsWith("aaelink://")) || null;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Forward a deep-link URL into the renderer. */
function dispatchDeepLink(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  focusMainWindow();
  mainWindow.webContents.send("aaelink-deep-link", { url });
}

// ── Badge / overlay helpers ───────────────────────────────────────────────────

function applyBadge(count) {
  globalBadgeCount = Math.max(0, count);

  // macOS Dock badge
  if (process.platform === "darwin") {
    try {
      app.dock.setBadge(globalBadgeCount > 0 ? String(globalBadgeCount) : "");
    } catch { /* ignore */ }
  }

  // Windows taskbar overlay icon
  if (process.platform === "win32" && mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (globalBadgeCount > 0) {
        // Electron accepts a nativeImage; an empty image still triggers the OS badge dot.
        mainWindow.setOverlayIcon(nativeImage.createEmpty(), `${globalBadgeCount} unread`);
      } else {
        mainWindow.setOverlayIcon(null, "");
      }
    } catch { /* ignore */ }
  }

  // Tray tooltip
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(
      globalBadgeCount > 0 ? `AAELink — ${globalBadgeCount} unread` : "AAELink"
    );
  }
}

// ── System Tray ───────────────────────────────────────────────────────────────

function createTray(iconPath) {
  // Always create tray, even on macOS (shows up in menu bar).
  if (!iconPath) return;
  try {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip("AAELink");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Open AAELink",
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) createWindow();
            else focusMainWindow();
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => { app.isQuiting = true; app.quit(); },
        },
      ])
    );
    tray.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
      else focusMainWindow();
    });
  } catch { /* ignore — tray is enhancement, not critical */ }
}

// ── IPC: badge count (driven by renderer notification stream) ─────────────────
// Registered before registerIpcHandlers so it's available at startup.
ipcMain.handle("aaelink:set-badge-count", (_event, count) => {
  try {
    applyBadge(typeof count === "number" ? count : 0);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// ── Core IPC handlers (notify, file dialog, navigate-home) ───────────────────
registerIpcHandlers({ getMainWindow: () => mainWindow });

// ── BrowserWindow ─────────────────────────────────────────────────────────────

function createWindow() {
  const startUrl = resolveStartUrl();
  const iconPath = resolveWindowIcon();

  const savedBounds = loadWindowBounds();

  const win = new BrowserWindow({
    width:     savedBounds?.width  || 1360,
    height:    savedBounds?.height || 880,
    ...(savedBounds?.x != null && savedBounds?.y != null ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth:  400,
    minHeight: 360,
    title:     "AAELink",
    show:      false,                          // hidden until content is ready
    backgroundColor: "#001d36",                // AAE navy — eliminates white flash
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox:          true,
    },
  });

  mainWindow = win;

  // Show window only after the first paint to avoid white flash
  win.once("ready-to-show", () => {
    win.show();
  });

  // Safety: if ready-to-show never fires (e.g. server error), show after 4 s.
  const showTimeout = setTimeout(() => { if (!win.isDestroyed()) win.show(); }, 4000);
  win.once("ready-to-show", () => clearTimeout(showTimeout));

  // Close button minimises to tray (unless app is actually quitting)
  win.on("close", (e) => {
    if (tray && !app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Save bounds on resize/move (debounced)
  let boundsTimer = null;
  const debounceSaveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveWindowBounds, 500);
  };
  win.on("resize", debounceSaveBounds);
  win.on("move", debounceSaveBounds);

  // Helper: load offline.html with the failed URL + detected IP pre-filled.
  const loadOffline = (failedUrl) => {
    if (win.isDestroyed()) return;
    const detectedIp = (__discovery && __discovery.detectedIp) || "";
    win.loadFile(path.join(__dirname, "offline.html"), {
      hash:   failedUrl ? encodeURIComponent(failedUrl) : undefined,
      search: detectedIp ? `detectedIp=${encodeURIComponent(detectedIp)}` : undefined,
    });
  };

  if (!startUrl) {
    // No server URL — go straight to the connect page (pre-filled with detected IP).
    loadOffline("");
  } else {
    // did-fail-load fires for *real* failures (DNS, connection refused, TLS,
    // server timeouts). It does NOT fire for ERR_ABORTED (-3), which is what
    // happens on a normal HTTP redirect chain (e.g. / → /login). The previous
    // implementation awaited loadURL() and treated -3 as a failure, falling
    // back to offline.html even when the server was perfectly reachable —
    // that was the "blank" / "connect screen" symptom. Listen to the event
    // instead so we only show offline.html when the network actually failed.
    let failed = false;
    const onFailLoad = (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      // Filter the redirect-aborted "errors" out completely.
      if (errorCode === -3 /* ERR_ABORTED */) return;
      if (failed) return;
      failed = true;
      console.error(
        `[AAELink] load failed: ${errorCode} ${errorDescription} url=${validatedUrl}`
      );
      loadOffline(startUrl);
    };
    win.webContents.on("did-fail-load", onFailLoad);

    // Belt-and-braces 9 s top-end timeout: if the server never responds at all
    // (no did-finish-load, no did-fail-load — e.g. network black-hole), fall
    // through to the connect page so the user isn't stuck on a blank window.
    const timeoutId = setTimeout(() => {
      if (failed || win.isDestroyed()) return;
      const url = win.webContents.getURL();
      if (!url || url === "about:blank") {
        failed = true;
        console.error(`[AAELink] load timed out for ${startUrl}`);
        loadOffline(startUrl);
      }
    }, 9000);
    win.webContents.once("did-finish-load", () => clearTimeout(timeoutId));

    win.loadURL(startUrl).catch((err) => {
      // loadURL itself can reject for the same -3 reason; treat the same way.
      const msg = err?.message || String(err);
      if (msg.includes("ERR_ABORTED")) return;
      if (!failed) {
        failed = true;
        console.error("[AAELink] loadURL rejected:", msg);
        loadOffline(startUrl);
      }
    });
  }

  // Open external links in the OS default browser, never inside Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    // Allow navigation away from the offline page (connect form submission)
    const currentUrl = win.webContents.getURL();
    if (currentUrl.startsWith("file://") && currentUrl.includes("offline.html")) {
      return;
    }

    try {
      const target = new URL(url);
      const origin = new URL(currentUrl); // Use the actual current origin, not the initial startUrl
      if (target.origin !== origin.origin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch { /* allow if parsing fails */ }
  });
}

// ── Second-instance (Windows/Linux single-instance + deep link relay) ─────────
app.on("second-instance", (_event, argv) => {
  focusMainWindow();
  const deepLink = extractDeepLink(argv);
  if (deepLink) dispatchDeepLink(deepLink);
});

// ── macOS open-url (aaelink:// protocol activation) ──────────────────────────
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    dispatchDeepLink(url);
  } else {
    app.once("ready", () => {
      createWindow();
      mainWindow?.webContents.once("did-finish-load", () => dispatchDeepLink(url));
    });
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const iconPath = resolveWindowIcon();
  applyDockIcon(iconPath);

  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName:    "AAELink",
      applicationVersion: app.getVersion(),
      copyright:          "Copyright Advanced ID Asia Engineering Co., Ltd.",
    });
  }

  setApplicationMenu({ isDarwin: process.platform === "darwin" });
  createTray(iconPath);

  // Discover the server (own WiFi → localhost → saved → env) BEFORE creating
  // the window so the right URL is loaded the first time, no flash of the
  // connect page when a server is reachable. Time-bounded inside discovery
  // (each probe ≤1.2 s; ≤5 candidates → <6 s worst case).
  await runDiscovery();

  createWindow();
  initAutoUpdater();

  // Handle deep link present in the first launch argv (Windows/Linux).
  const firstLaunchDeepLink = extractDeepLink(process.argv);
  if (firstLaunchDeepLink && mainWindow) {
    mainWindow.webContents.once("did-finish-load", () =>
      dispatchDeepLink(firstLaunchDeepLink)
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  saveWindowBounds();
  app.isQuiting = true;
});

// ── System idle detection ─────────────────────────────────────────────────────
// Broadcast idle / active state to the renderer so it can update user presence.
const IDLE_THRESHOLD_SECONDS = 300; // 5 minutes
let lastIdleState = "active";

function checkIdleState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const newState = idleSeconds >= IDLE_THRESHOLD_SECONDS ? "idle" : "active";
    if (newState !== lastIdleState) {
      lastIdleState = newState;
      mainWindow.webContents.send("aaelink-idle-state", {
        state: newState,
        idle_seconds: idleSeconds,
      });
    }
  } catch { /* ignore */ }
}

// Check idle state every 30 seconds
setInterval(checkIdleState, 30_000);

// Forward power events (suspend/resume) so the renderer can reconnect streams
app.whenReady().then(() => {
  powerMonitor.on("suspend", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("aaelink-power-event", { event: "suspend" });
    }
  });
  powerMonitor.on("resume", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("aaelink-power-event", { event: "resume" });
    }
  });
  powerMonitor.on("lock-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("aaelink-idle-state", { state: "idle", idle_seconds: 0 });
    }
  });
  powerMonitor.on("unlock-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("aaelink-idle-state", { state: "active", idle_seconds: 0 });
    }
  });
});
