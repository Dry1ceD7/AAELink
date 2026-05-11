"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Secure IPC bridge exposed to the renderer (Next.js app) as `window.aaelinkDesktop`.
 *
 * Only whitelisted, named channels are bridged — no arbitrary ipcRenderer.send.
 */
contextBridge.exposeInMainWorld("aaelinkDesktop", {
  /** The host OS platform — used to show ⌘ vs Ctrl in shortcut hints. */
  platform: process.platform,

  // ── Native OS notification ──────────────────────────────────────────────
  /**
   * @param {{ title?: string; body: string; workspace_id?: string; focus_message_id?: string }} payload
   */
  notifyMessage: (payload) =>
    ipcRenderer.invoke("aaelink-notify-message", payload),

  // ── Native file picker ──────────────────────────────────────────────────
  /**
   * @param {{ properties?: string[]; filters?: { name: string; extensions: string[] }[] }} [options]
   * @returns {Promise<{ canceled: boolean; filePaths: string[] }>}
   */
  openFileDialog: (options) =>
    ipcRenderer.invoke("aaelink:open-file-dialog", options ?? {}),

  // ── Read selected file bytes (base64) for upload ────────────────────────
  /**
   * @param {string} filePath  Absolute path returned by openFileDialog
   * @returns {Promise<{ ok: boolean; base64?: string; size?: number; error?: string }>}
   */
  readFileBytes: (filePath) =>
    ipcRenderer.invoke("aaelink:read-file-bytes", filePath),

  // ── Unread-badge count (drives Dock badge + taskbar overlay) ────────────
  /**
   * @param {number} count  Total unread mention count across all channels/DMs
   * @returns {Promise<{ ok: boolean }>}
   */
  setBadgeCount: (count) =>
    ipcRenderer.invoke("aaelink:set-badge-count", count),

  // ── Inbound events from main process ────────────────────────────────────

  /**
   * Subscribe to notification-click navigation (focus a specific message).
   * @param {(payload: { workspace_id?: string; focus_message_id?: string }) => void} callback
   * @returns {() => void}  Unsubscribe
   */
  subscribeNavigateHome: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload ?? {});
    ipcRenderer.on("aaelink-navigate-home", listener);
    return () => ipcRenderer.removeListener("aaelink-navigate-home", listener);
  },

  /**
   * Subscribe to aaelink:// deep-link activations.
   * Payload: `{ url: string }` e.g. `aaelink://workspace/abc/channel/xyz`
   * @param {(payload: { url: string }) => void} callback
   * @returns {() => void}  Unsubscribe
   */
  subscribeDeepLink: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload ?? {});
    ipcRenderer.on("aaelink-deep-link", listener);
    return () => ipcRenderer.removeListener("aaelink-deep-link", listener);
  },

  // ── App Update ────────────────────────────────────────────────────────
  /**
   * Check for updates via GitHub Releases.
   * @returns {Promise<{ status: string; updateInfo?: object; error?: string }>}
   */
  checkForUpdate: () =>
    ipcRenderer.invoke("aaelink:check-for-update"),

  /**
   * Get the current update status.
   * @returns {Promise<{ status: string; version?: string; progress?: number; error?: string }>}
   */
  getUpdateStatus: () =>
    ipcRenderer.invoke("aaelink:get-update-status"),

  /**
   * Get the current app version and packaged state.
   * @returns {Promise<{ version: string; isPackaged: boolean }>}
   */
  getAppVersion: () =>
    ipcRenderer.invoke("aaelink:get-app-version"),

  /**
   * Install a downloaded update (quits and restarts).
   */
  installUpdate: () =>
    ipcRenderer.invoke("aaelink:install-update"),

  /**
   * Subscribe to update status events from the main process.
   * @param {(status: { status: string; version?: string; progress?: number; error?: string }) => void} callback
   * @returns {() => void}  Unsubscribe
   */
  subscribeUpdateStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, status) => callback(status ?? {});
    ipcRenderer.on("aaelink-update-status", listener);
    return () => ipcRenderer.removeListener("aaelink-update-status", listener);
  },

  // ── System idle state (idle / active transitions) ──────────────────────
  /**
   * Subscribe to system idle/active state changes.
   * Payload: `{ state: "idle" | "active", idle_seconds: number }`
   * @param {(payload: { state: string; idle_seconds: number }) => void} callback
   * @returns {() => void}  Unsubscribe
   */
  subscribeIdleState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload ?? {});
    ipcRenderer.on("aaelink-idle-state", listener);
    return () => ipcRenderer.removeListener("aaelink-idle-state", listener);
  },

  // ── Power events (suspend / resume) ────────────────────────────────────
  /**
   * Subscribe to system power events (suspend/resume).
   * Payload: `{ event: "suspend" | "resume" }`
   * @param {(payload: { event: string }) => void} callback
   * @returns {() => void}  Unsubscribe
   */
  subscribePowerEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload ?? {});
    ipcRenderer.on("aaelink-power-event", listener);
    return () => ipcRenderer.removeListener("aaelink-power-event", listener);
  },

  // ── System information ─────────────────────────────────────────────────
  /**
   * Get system information for the About panel.
   * @returns {Promise<{
   *   hostname: string; platform: string; arch: string;
   *   os_version: string; os_type: string;
   *   total_memory_mb: number; free_memory_mb: number;
   *   uptime_hours: number; cpus: number;
   *   node_version: string; electron_version: string; chrome_version: string;
   *   user_data_path: string;
   * }>}
   */
  getSystemInfo: () =>
    ipcRenderer.invoke("aaelink:get-system-info"),

  // ── Zoom controls ──────────────────────────────────────────────────────
  /**
   * Zoom the window content.
   * @param {"in" | "out" | "reset"} action
   * @returns {Promise<{ ok: boolean; zoom?: number }>}
   */
  zoom: (action) =>
    ipcRenderer.invoke("aaelink:zoom", action),

  // ── Window controls ────────────────────────────────────────────────────
  /**
   * Control the main window.
   * @param {"minimize" | "maximize" | "fullscreen"} action
   * @returns {Promise<{ ok: boolean }>}
   */
  windowControl: (action) =>
    ipcRenderer.invoke("aaelink:window-control", action),

  // ── Clipboard ───────────────────────────────────────────────────────────
  /**
   * Write text to the system clipboard.
   * @param {string} text
   * @returns {Promise<{ ok: boolean }>}
   */
  clipboardWrite: (text) =>
    ipcRenderer.invoke("aaelink:clipboard-write", text),

  /**
   * Read text from the system clipboard.
   * @returns {Promise<{ ok: boolean; text?: string }>}
   */
  clipboardRead: () =>
    ipcRenderer.invoke("aaelink:clipboard-read"),

  // ── Open external URL ──────────────────────────────────────────────────
  /**
   * Open a URL in the system default browser.
   * @param {string} url
   * @returns {Promise<{ ok: boolean }>}
   */
  openExternal: (url) =>
    ipcRenderer.invoke("aaelink:open-external", url),

  // ── App version ─────────────────────────────────────────────────────────
  /**
   * Get the Electron app version and name.
   * @returns {Promise<{ version: string; name: string }>}
   */
  getAppVersion: () =>
    ipcRenderer.invoke("aaelink:get-app-version"),

  // ── Server discovery (used by the offline / connect screen) ────────────
  /**
   * Get the WiFi IP this Mac is currently using and the last URL we saved.
   * @returns {Promise<{ ok: boolean; detectedIp: string; savedUrl: string; defaultPort: number }>}
   */
  getDiscoveryInfo: () =>
    ipcRenderer.invoke("aaelink:get-discovery-info"),

  /**
   * Probe whether a server URL is reachable (HEAD/GET /api/health, ~1.2 s timeout).
   * @param {string} url
   * @returns {Promise<{ ok: boolean; reachable?: boolean }>}
   */
  probeServer: (url) =>
    ipcRenderer.invoke("aaelink:probe-server", url),

  /**
   * Persist a server URL to userData so it survives across launches and WiFi changes.
   * @param {string} url
   * @returns {Promise<{ ok: boolean; error?: string }>}
   */
  saveServerUrl: (url) =>
    ipcRenderer.invoke("aaelink:save-server-url", url),

  /**
   * Probe + save + navigate the main window to a server URL.
   * @param {string} url
   * @returns {Promise<{ ok: boolean; error?: string }>}
   */
  connectNow: (url) =>
    ipcRenderer.invoke("aaelink:connect-now", url),
});
