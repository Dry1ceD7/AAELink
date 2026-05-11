"use strict";

const { ipcMain, dialog, Notification } = require("electron");
const {
  detectWifiIPv4,
  probeUrl,
  saveUrl: saveDiscoveredUrl,
  loadSavedUrl,
  DEFAULT_PORT,
} = require("./discovery");

/**
 * IPC bridge: main process handles privileged OS work.
 * Renderer (Next.js app) calls via preload `window.aaelinkDesktop.*`.
 *
 * Channels handled here:
 *   aaelink-notify-message    — show a native OS notification
 *   aaelink:open-file-dialog  — open native file-picker and return absolute paths
 *   aaelink:read-file-bytes   — read a local file and return base64 for upload
 *
 * The badge-count channel (aaelink:set-badge-count) is registered directly in
 * main.js before this module loads so it can reference the window reference.
 *
 * @param {{ getMainWindow: () => import("electron").BrowserWindow | null }} ctx
 */
function registerIpcHandlers(ctx) {
  // ── Desktop notification ──────────────────────────────────────────────────
  ipcMain.handle("aaelink-notify-message", (_event, payload) => {
    try {
      const title          = String(payload?.title   ?? "AAELink").trim().slice(0, 200);
      const body           = String(payload?.body    ?? "").trim().slice(0, 500);
      const workspaceId    = String(payload?.workspace_id    ?? "").trim();
      const focusMessageId = String(payload?.focus_message_id ?? "").trim();

      if (!body) return { ok: false };
      if (typeof Notification === "undefined" || !Notification.isSupported()) return { ok: false };

      const n = new Notification({ title: title || "AAELink", body });

      n.on("click", () => {
        const mainWindow = ctx.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          if (workspaceId && focusMessageId && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send("aaelink-navigate-home", {
              workspace_id:     workspaceId,
              focus_message_id: focusMessageId,
            });
          }
        }
      });

      n.show();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // ── Native file picker ────────────────────────────────────────────────────
  ipcMain.handle("aaelink:open-file-dialog", async (event, options) => {
    const { BrowserWindow } = require("electron");
    const win = BrowserWindow.fromWebContents(event.sender) || ctx.getMainWindow();

    const ALLOWED_PROPS = ["openFile", "multiSelections", "openDirectory"];
    const props = Array.isArray(options?.properties) ? options.properties : ["openFile"];
    const safeProps = props.filter((p) => ALLOWED_PROPS.includes(p));

    const result = await dialog.showOpenDialog(win || undefined, {
      properties: safeProps.length ? safeProps : ["openFile"],
      filters:    Array.isArray(options?.filters) ? options.filters : undefined,
    });

    return { canceled: result.canceled, filePaths: result.filePaths || [] };
  });

  // ── Read file bytes for upload ────────────────────────────────────────────
  // Renderer calls this after open-file-dialog returns a path; gets back base64
  // so it can POST directly to the /api/documents or S3 presigned URL endpoint.
  ipcMain.handle("aaelink:read-file-bytes", async (_event, filePath) => {
    try {
      if (typeof filePath !== "string" || !filePath.trim()) {
        return { ok: false, error: "invalid_path" };
      }
      // Security: only allow files the user explicitly selected (open-dialog provides abs paths).
      const abs = filePath.trim();
      const stat = await require("fs/promises").stat(abs);
      // 50 MB guard — large files should use multipart / presigned S3 directly.
      if (stat.size > 50 * 1024 * 1024) return { ok: false, error: "file_too_large" };
      const buf = await require("fs/promises").readFile(abs);
      return { ok: true, base64: buf.toString("base64"), size: stat.size };
    } catch (e) {
      return { ok: false, error: String(e?.message || "read_failed") };
    }
  });
  // ── System info for About panel ──────────────────────────────────────────
  ipcMain.handle("aaelink:get-system-info", () => {
    const os = require("os");
    return {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      os_version: os.release(),
      os_type: os.type(),
      total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
      free_memory_mb: Math.round(os.freemem() / 1024 / 1024),
      uptime_hours: Math.round(os.uptime() / 3600 * 10) / 10,
      cpus: os.cpus().length,
      node_version: process.versions.node,
      electron_version: process.versions.electron,
      chrome_version: process.versions.chrome,
      user_data_path: require("electron").app.getPath("userData"),
    };
  });

  // ── Zoom controls ──────────────────────────────────────────────────────────
  ipcMain.handle("aaelink:zoom", (_event, action) => {
    const mainWindow = ctx.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    const wc = mainWindow.webContents;
    const current = wc.getZoomFactor();
    switch (action) {
      case "in":
        wc.setZoomFactor(Math.min(current + 0.1, 2.0));
        break;
      case "out":
        wc.setZoomFactor(Math.max(current - 0.1, 0.5));
        break;
      case "reset":
        wc.setZoomFactor(1.0);
        break;
      default:
        return { ok: false, error: "unknown_action" };
    }
    return { ok: true, zoom: wc.getZoomFactor() };
  });

  // ── Window controls ────────────────────────────────────────────────────────
  ipcMain.handle("aaelink:window-control", (_event, action) => {
    const mainWindow = ctx.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    switch (action) {
      case "minimize":
        mainWindow.minimize();
        break;
      case "maximize":
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        break;
      case "fullscreen":
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
        break;
      default:
        return { ok: false, error: "unknown_action" };
    }
    return { ok: true };
  });

  // ── Clipboard ───────────────────────────────────────────────────────────
  ipcMain.handle("aaelink:clipboard-write", (_event, text) => {
    const { clipboard } = require("electron");
    if (typeof text !== "string") return { ok: false, error: "text_required" };
    clipboard.writeText(text);
    return { ok: true };
  });

  ipcMain.handle("aaelink:clipboard-read", () => {
    const { clipboard } = require("electron");
    return { ok: true, text: clipboard.readText() };
  });

  // ── Open external URL ──────────────────────────────────────────────────
  ipcMain.handle("aaelink:open-external", async (_event, url) => {
    const { shell } = require("electron");
    if (typeof url !== "string" || (!url.startsWith("https://") && !url.startsWith("http://"))) {
      return { ok: false, error: "invalid_url" };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  // ── Get app version ────────────────────────────────────────────────────
  ipcMain.handle("aaelink:get-app-version", () => {
    const { app } = require("electron");
    return { version: app.getVersion(), name: app.getName() };
  });

  // ── Server discovery (used by offline.html / connect screen) ──────────
  // The connect page calls these so it can pre-fill the detected WiFi IP
  // and persist user-entered URLs to userData (durable across launches,
  // unlike localStorage which is fragile under file:// hosts).
  ipcMain.handle("aaelink:get-discovery-info", async () => {
    try {
      const { app } = require("electron");
      const detectedIp = await detectWifiIPv4();
      const savedUrl = loadSavedUrl(app);
      return {
        ok: true,
        detectedIp: detectedIp || "",
        savedUrl: savedUrl || "",
        defaultPort: DEFAULT_PORT,
      };
    } catch {
      return { ok: false, detectedIp: "", savedUrl: "", defaultPort: DEFAULT_PORT };
    }
  });

  ipcMain.handle("aaelink:probe-server", async (_event, url) => {
    if (typeof url !== "string" || !url) return { ok: false };
    const reachable = await probeUrl(url);
    return { ok: true, reachable };
  });

  ipcMain.handle("aaelink:save-server-url", (_event, url) => {
    try {
      const { app } = require("electron");
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        return { ok: false, error: "invalid_url" };
      }
      saveDiscoveredUrl(app, url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || "save_failed") };
    }
  });

  // Allow the offline page to navigate the window to a chosen URL (it's a
  // file:// page; window.location.href = http://... is blocked by some
  // navigation rules in packaged builds, so we use IPC instead).
  ipcMain.handle("aaelink:connect-now", async (event, url) => {
    try {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.fromWebContents(event.sender) || ctx.getMainWindow();
      if (!win || win.isDestroyed()) return { ok: false, error: "no_window" };
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        return { ok: false, error: "invalid_url" };
      }
      const reachable = await probeUrl(url);
      if (!reachable) return { ok: false, error: "unreachable" };
      const { app } = require("electron");
      saveDiscoveredUrl(app, url);
      win.loadURL(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || "connect_failed") };
    }
  });
}

module.exports = { registerIpcHandlers };
