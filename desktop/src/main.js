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

const { app, BrowserWindow, nativeImage, shell, Tray, Menu, ipcMain } = require("electron");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const { initAutoUpdater }     = require("./main/autoUpdater");
const { registerIpcHandlers } = require("./main/ipcHandlers");
const { setApplicationMenu }  = require("./main/nativeMenu");
const { DEFAULT_APP_ORIGIN }  = require("./shared/constants");

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
  return DEFAULT_APP_ORIGIN;
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

const __startUrlForCertSwitch = computeStartUrl();
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

  const win = new BrowserWindow({
    width:     1360,
    height:    880,
    minWidth:  400,
    minHeight: 360,
    title:     "AAELink",
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox:          true,
    },
  });

  mainWindow = win;

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

  win.loadURL(startUrl).catch((err) => {
    console.error("Failed to load URL:", startUrl, err);
    win.loadFile(path.join(__dirname, "offline.html"), {
      hash: encodeURIComponent(startUrl),
    });
  });

  // Open external links in the OS default browser, never inside Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      const origin = new URL(startUrl);
      if (target.origin !== origin.origin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch { /* allow same-origin navigation */ }
  });

  win.webContents.openDevTools();
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
app.whenReady().then(() => {
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
  app.isQuiting = true;
});
