"use strict";

/**
 * GitHub Releases OTA for the packaged desktop shell (electron-updater).
 * See docs/architecture/enterprise-superapp-architecture.md (notification + lifecycle sections).
 */

const { app } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");

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

function initAutoUpdater() {
  if (!app.isPackaged) return;
  if (process.env.AAELINK_DISABLE_UPDATES === "1") return;

  const customBase = process.env.AAELINK_UPDATES_BASE_URL?.trim();
  if (customBase) {
    autoUpdater.setFeedURL({ provider: "generic", url: customBase.replace(/\/$/, "") });
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;

  autoUpdater.on("error", (e) => logLine("error", e));
  autoUpdater.on("checking-for-update", () => logLine("checking-for-update"));
  autoUpdater.on("update-available", (info) => logLine(`update-available ${info.version}`));
  autoUpdater.on("update-not-available", (info) => {
    logLine(`update-not-available ${info && info.version ? info.version : ""}`.trim());
  });
  autoUpdater.on("download-progress", (p) => {
    if (process.env.AAELINK_UPDATER_DEBUG === "1") {
      logLine(`download-progress ${Math.round(p.percent)}%`);
    }
  });
  autoUpdater.on("update-downloaded", (info) => logLine(`update-downloaded ${info.version} (will install on quit)`));

  const check = () => {
    autoUpdater.checkForUpdates().catch((e) => logLine("checkForUpdates failed", e));
  };

  setTimeout(check, 12_000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

module.exports = { initAutoUpdater };
