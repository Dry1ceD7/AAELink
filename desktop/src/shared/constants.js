"use strict";

/** Default Next dev port (repo root `npm run dev`). */
exports.DEFAULT_DEV_PORT = 3040;

/**
 * Packaged-app fallback when AAELINK_DESKTOP_URL is unset.
 * Left blank so the connect screen (offline.html) is shown on first launch,
 * prompting the user to enter the server host's WiFi IP address.
 * In development mode, main.js auto-detects the host machine's LAN/WiFi IP.
 */
exports.DEFAULT_APP_ORIGIN = "";
