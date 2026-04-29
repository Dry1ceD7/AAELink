"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Secure IPC bridge exposed to the renderer (Next.js app) as `window.aaelinkDesktop`.
 *
 * Only whitelisted, named channels are bridged — no arbitrary ipcRenderer.send.
 */
contextBridge.exposeInMainWorld("aaelinkDesktop", {
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
});
