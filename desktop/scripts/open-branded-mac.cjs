'use strict'

/**
 * Opens the electron-builder "dir" output so macOS shows **AAELink** in the Dock (not "Electron").
 * Unpackaged `electron .` cannot change the Dock hover label — that comes from the .app bundle.
 */

const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')

if (process.platform !== 'darwin') {
  console.error('start:branded is macOS-only. On Windows use the NSIS installer for the correct taskbar name.')
  process.exit(1)
}

const desktopRoot = path.join(__dirname, '..')
const candidates = [
  path.join(desktopRoot, 'dist', 'mac-arm64', 'AAELink.app'),
  path.join(desktopRoot, 'dist', 'mac', 'AAELink.app')
]

function findApp() {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

let appPath = findApp()
if (!appPath) {
  console.error('AAELink.app not found under desktop/dist/. Building unpacked app (first run can take ~1 minute)...')
  execSync('npx electron-builder --dir', { cwd: desktopRoot, stdio: 'inherit', env: process.env })
  appPath = findApp()
}
if (!appPath) {
  console.error('Build finished but AAELink.app was not found. Try: npm run pack --prefix desktop')
  process.exit(1)
}

const urlArg = process.env.AAELINK_DESKTOP_URL && process.env.AAELINK_DESKTOP_URL.trim()
const openArgs = urlArg ? [appPath, '--args', `--url=${urlArg}`] : [appPath]
const r = spawnSync('open', openArgs, { stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status ?? 1)
