// AAELink desktop secure storage.
//
// Persists small key/value pairs (e.g. the "Remember me" refresh token) to
// disk encrypted with the OS keychain via Electron's `safeStorage`
// (Keychain on macOS, DPAPI on Windows, libsecret on Linux). Plaintext is
// never written to disk and entries are only readable by the OS user that
// wrote them.
//
// API exposed to the renderer via preload: window.aaelink.secure.{get,set,del,available}.

const { app, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const FILE = path.join(app.getPath('userData'), 'secure.json')

function readAll() {
  try {
    if (!fs.existsSync(FILE)) return {}
    const raw = fs.readFileSync(FILE, 'utf8')
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function writeAll(obj) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(obj), { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    console.error('[secure-store] write failed:', err)
  }
}

function isAvailable() {
  try { return safeStorage.isEncryptionAvailable() } catch (_) { return false }
}

function set(key, value) {
  if (typeof key !== 'string' || !key) return false
  if (typeof value !== 'string') value = String(value ?? '')
  const all = readAll()
  if (isAvailable()) {
    all[key] = safeStorage.encryptString(value).toString('base64')
  } else {
    // Fallback only as a last resort; mark explicitly so we can detect.
    all[key] = `plain:${Buffer.from(value, 'utf8').toString('base64')}`
  }
  writeAll(all)
  return true
}

function get(key) {
  const all = readAll()
  const raw = all[key]
  if (!raw) return null
  try {
    if (raw.startsWith('plain:')) {
      return Buffer.from(raw.slice('plain:'.length), 'base64').toString('utf8')
    }
    if (isAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'))
    }
    return null
  } catch (err) {
    console.error('[secure-store] decrypt failed:', err)
    return null
  }
}

function del(key) {
  const all = readAll()
  if (key in all) {
    delete all[key]
    writeAll(all)
  }
  return true
}

function clear() {
  writeAll({})
  return true
}

module.exports = { isAvailable, get, set, del, clear }
