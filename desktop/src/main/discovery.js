"use strict";

/**
 * AAELink server discovery.
 *
 * Goal: whichever WiFi the host Mac is on, find the running AAELink server
 * automatically — no per-network reconfiguration. Works for the same-Mac case
 * (server + desktop on this MacBook) and the cross-device LAN case.
 *
 * Strategy on every launch:
 *   1. If AAELINK_DESKTOP_URL or --url= is set, use it.
 *   2. Probe last-saved URL (1.2 s timeout). Fast path on stable network.
 *   3. Detect current WiFi IPv4 via UDP-connect trick (gets the iface
 *      that holds the default route — the one the user is actually on).
 *   4. Probe candidate list: localhost, detected IP, both http+https, port 3040.
 *   5. First successful probe wins. Persist to disk for next launch.
 *   6. If everything fails, return null → caller shows offline.html with the
 *      detected IP pre-filled so a single click recovers.
 */

const dgram = require("dgram");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { net } = require("electron");

const DEFAULT_PORT = 3040;
const PROBE_TIMEOUT_MS = 1200;
const HEALTH_PATH = "/api/health";

/**
 * Resolve the local IPv4 the OS would use to reach the public internet.
 * Doesn't actually send any packet — UDP "connect" only sets the default
 * route for the socket, then `address()` reports the local side.
 *
 * Returns an IPv4 string or null. Always non-loopback when it resolves.
 */
function detectDefaultRouteIPv4() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch { /* ignore */ }
      resolve(v);
    };
    const sock = dgram.createSocket("udp4");
    sock.on("error", () => finish(null));
    setTimeout(() => finish(null), 500);
    try {
      // 8.8.8.8:80 — never actually contacted, just resolves the route table.
      sock.connect(80, "8.8.8.8", () => {
        try {
          const a = sock.address();
          finish(a && a.address && a.address !== "0.0.0.0" ? a.address : null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Fallback IP detection if UDP-connect isn't available — scans interfaces,
 * preferring `en0`/`en1` (typical WiFi on macOS) and RFC1918 ranges.
 */
function detectIPv4Fallback() {
  const nets = os.networkInterfaces();
  /** @type {Array<{ iface: string; address: string }>} */
  const candidates = [];
  for (const iface of Object.keys(nets)) {
    for (const n of nets[iface] || []) {
      const fam = n.family;
      if ((fam !== "IPv4" && fam !== 4) || n.internal) continue;
      candidates.push({ iface, address: n.address });
    }
  }
  const score = ({ iface, address }) => {
    let s = 0;
    if (/^en0$/i.test(iface)) s += 1000;       // primary WiFi on most macs
    else if (/^en\d$/i.test(iface)) s += 800;
    else if (/^bridge/i.test(iface)) s += 100; // shared-network adapters last
    const p = address.split(".").map(Number);
    if (p.length === 4) {
      if (p[0] === 192 && p[1] === 168) s += 400;
      else if (p[0] === 10) s += 300;
      else if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) s += 200;
    }
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0]?.address || null;
}

/**
 * Best WiFi-side IPv4 for THIS machine.
 *
 * Prefer the interface scan (en0/en1 RFC1918) over the UDP-connect trick:
 * when a VPN is active, UDP-connect picks the tunnel iface (e.g. utun0 →
 * 172.16.x.y) which is *not* the WiFi address other devices reach you at.
 * Only fall back to UDP-connect if no WiFi-style interface is present.
 */
async function detectWifiIPv4() {
  const wifi = detectIPv4Fallback();
  if (wifi) return wifi;
  return detectDefaultRouteIPv4();
}

/**
 * Return all reasonable candidate IPv4s for this Mac (de-duplicated).
 * Used to widen the probe set so we don't miss a server that binds to a
 * specific iface when the user has VPN + WiFi + Ethernet active.
 */
async function detectAllLocalIPv4s() {
  const set = new Set();
  const wifi = detectIPv4Fallback();
  if (wifi) set.add(wifi);
  const route = await detectDefaultRouteIPv4();
  if (route) set.add(route);
  // Also include any other non-internal IPv4 — cheap and covers Ethernet.
  const nets = os.networkInterfaces();
  for (const iface of Object.keys(nets)) {
    for (const n of nets[iface] || []) {
      if ((n.family === "IPv4" || n.family === 4) && !n.internal) set.add(n.address);
    }
  }
  return [...set];
}

/**
 * Probe a URL with a short timeout. Resolves to true if the server answers
 * any HTTP status (so 200, 401, 503 all count — we just want to know it's there).
 *
 * Uses Electron's net module so it runs inside the same TLS / proxy stack
 * as the renderer, including the `ignore-certificate-errors` switch.
 */
function probeUrl(url, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { req.abort(); } catch { /* ignore */ }
      resolve(v);
    };

    let req;
    try {
      const u = new URL(HEALTH_PATH, url);
      req = net.request({ method: "GET", url: u.toString(), redirect: "manual" });
    } catch {
      return resolve(false);
    }

    const timer = setTimeout(() => finish(false), timeoutMs);
    req.on("response", (res) => { clearTimeout(timer); finish(true); res.resume?.(); });
    req.on("error", () => { clearTimeout(timer); finish(false); });
    req.on("abort", () => { clearTimeout(timer); finish(false); });
    try { req.end(); } catch { finish(false); }
  });
}

/** Build the candidate URL list from one or more detected IPs. */
function buildCandidates(ips) {
  /** @type {string[]} */
  const hosts = ["localhost"];
  for (const ip of (Array.isArray(ips) ? ips : [ips])) {
    if (ip && ip !== "127.0.0.1" && !hosts.includes(ip)) hosts.push(ip);
  }
  /** @type {string[]} */
  const out = [];
  for (const host of hosts) {
    out.push(`http://${host}:${DEFAULT_PORT}`);
    out.push(`https://${host}:${DEFAULT_PORT}`);
  }
  return out;
}

function urlsForUserData(app) {
  const dir = app.getPath("userData");
  return {
    dir,
    saved: path.join(dir, "server-url.json"),
  };
}

function loadSavedUrl(app) {
  try {
    const { saved } = urlsForUserData(app);
    if (!fs.existsSync(saved)) return null;
    const data = JSON.parse(fs.readFileSync(saved, "utf-8"));
    if (data && typeof data.url === "string" && /^https?:\/\//.test(data.url)) {
      return data.url;
    }
  } catch { /* ignore */ }
  return null;
}

function saveUrl(app, url) {
  try {
    const { dir, saved } = urlsForUserData(app);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(saved, JSON.stringify({ url, savedAt: Date.now() }), "utf-8");
  } catch { /* ignore */ }
}

function readArgUrl(argv) {
  const arg = argv.find((a) => a.startsWith("--url="));
  return arg ? arg.slice("--url=".length).trim() : null;
}

/**
 * Run discovery. Returns:
 *   { url, source, detectedIp }
 * where `url` is the working server URL (or null if none responded), and
 * `source` is one of: env | arg | saved | localhost | wifi | none.
 *
 * `detectedIp` is exposed so the offline page can pre-fill it when discovery
 * fails — turns the worst case into one click instead of typing.
 */
async function discoverServerUrl({ app, argv = process.argv, env = process.env }) {
  const allIps = await detectAllLocalIPv4s();
  const detectedIp = await detectWifiIPv4();

  const explicit = (env.AAELINK_DESKTOP_URL || readArgUrl(argv) || "").trim();
  if (explicit) {
    return { url: explicit, source: "env", detectedIp };
  }

  // Try the last-saved URL first for fast warm starts. If it fails (e.g.
  // moved to a different WiFi), we silently fall through and re-discover.
  const saved = loadSavedUrl(app);
  if (saved) {
    if (await probeUrl(saved)) {
      return { url: saved, source: "saved", detectedIp };
    }
  }

  // Probe localhost + every detected iface IP, http and https. First reply wins.
  const candidates = buildCandidates(allIps);
  for (const url of candidates) {
    if (await probeUrl(url)) {
      saveUrl(app, url);
      const source = url.includes("localhost") ? "localhost" : "wifi";
      return { url, source, detectedIp };
    }
  }

  return { url: null, source: "none", detectedIp };
}

module.exports = {
  discoverServerUrl,
  detectWifiIPv4,
  detectAllLocalIPv4s,
  probeUrl,
  saveUrl,
  loadSavedUrl,
  DEFAULT_PORT,
};
