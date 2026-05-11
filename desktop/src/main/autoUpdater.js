"use strict";

/**
 * GitHub Releases OTA for the packaged desktop shell (electron-updater).
 * 
 * v2: Now sends update events to the renderer so the UI can show update status,
 *     progress, and prompt the user to restart.
 */

const { app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

/** @type {{ status: string; version?: string; progress?: number; error?: string }} */
let lastUpdateStatus = { status: "idle" };

function logLine(message, err) {
  const tail = err ? ` ${err && err.message ? err.message : String(err)}` : "";
  const line = `[${new Date().toISOString()}] ${message}${tail}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "updater.log"), line);
  } catch {
    /* ignore */
  }
  if (process.env.AAELINK_UPDATER_DEBUG === "1") {
    console.log("[AAELink updater]", message, err || "");
  }
}

/** Send update status to all renderer windows. */
function broadcastUpdateStatus(status) {
  lastUpdateStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("aaelink-update-status", status);
    }
  }
}

function initAutoUpdater() {
  // ── IPC: renderer can request update check ──────────────────────────────
  ipcMain.handle("aaelink:check-for-update", async () => {
    if (!app.isPackaged) {
      return { status: "dev-mode", version: app.getVersion() };
    }
    try {
      broadcastUpdateStatus({ status: "checking" });
      const result = await autoUpdater.checkForUpdates();
      return { status: "ok", updateInfo: result?.updateInfo };
    } catch (e) {
      return { status: "error", error: e?.message || String(e) };
    }
  });

  ipcMain.handle("aaelink:get-update-status", () => {
    return lastUpdateStatus;
  });


  // Note: aaelink:get-app-version is registered by ipcHandlers.js

  ipcMain.handle("aaelink:install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Don't auto-check if not packaged
  if (!app.isPackaged) return;
  if (process.env.AAELINK_DISABLE_UPDATES === "1") return;

  const customBase = process.env.AAELINK_UPDATES_BASE_URL?.trim();
  if (customBase) {
    autoUpdater.setFeedURL({ provider: "generic", url: customBase.replace(/\/$/, "") });
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;

  autoUpdater.on("error", (e) => {
    logLine("error", e);
    broadcastUpdateStatus({ status: "error", error: e?.message || String(e) });
  });

  autoUpdater.on("checking-for-update", () => {
    logLine("checking-for-update");
    broadcastUpdateStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    logLine(`update-available ${info.version}`);
    broadcastUpdateStatus({ status: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", (info) => {
    logLine(`update-not-available ${info && info.version ? info.version : ""}`.trim());
    broadcastUpdateStatus({ status: "up-to-date", version: info?.version });
  });

  autoUpdater.on("download-progress", (p) => {
    if (process.env.AAELINK_UPDATER_DEBUG === "1") {
      logLine(`download-progress ${Math.round(p.percent)}%`);
    }
    broadcastUpdateStatus({ status: "downloading", progress: Math.round(p.percent) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    logLine(`update-downloaded ${info.version} (will install on quit)`);
    broadcastUpdateStatus({ status: "ready", version: info.version });
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((e) => logLine("checkForUpdates failed", e));
  };

  setTimeout(check, 12_000);
  setInterval(check, 4 * 60 * 60 * 1000); // every 4 hours
}

module.exports = { initAutoUpdater };
