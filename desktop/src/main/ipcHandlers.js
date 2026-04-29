"use strict";

const { ipcMain, dialog, Notification } = require("electron");

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
}

module.exports = { registerIpcHandlers };
