"use strict";

/** Default Next dev port (repo root `npm run dev`). */
exports.DEFAULT_DEV_PORT = 3040;

/** Packaged fallback when AAELINK_DESKTOP_URL is unset (development uses HTTPS + Wi‑Fi IP in main.js). */
exports.DEFAULT_APP_ORIGIN = `https://192.168.11.80:${exports.DEFAULT_DEV_PORT}`;
