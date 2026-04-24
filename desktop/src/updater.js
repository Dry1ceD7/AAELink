// AAELink desktop OTA updater.
//
// We deliberately avoid electron-updater because the release pipeline is not
// allowed to publish `latest*.yml` / `*.blockmap` metadata (release asset
// whitelist). Instead we query the GitHub Releases REST API directly, compare
// the latest published tag against the running app version, and if a newer
// build is available we download the matching installer for the current
// platform and launch it.
//
// Failures are intentionally swallowed and logged: an update problem must
// never block the app from starting or interrupt the UI.

const { app, shell, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const https = require('node:https')
const { spawn } = require('node:child_process')

const REPO = process.env.AAELINK_UPDATE_REPO || 'Dry1ceD7/AAELink'
const CHECK_DELAY_MS = 10_000
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h

function log(...args) {
  try { console.log('[updater]', ...args) } catch (_) {}
}

// Loose semver compare ("0.0.1-alpha" vs "0.0.2-alpha.1" etc).
// Returns >0 if `a` > `b`, <0 if a<b, 0 if equal.
function compareVersions(a, b) {
  const norm = (v) => String(v || '').replace(/^v/, '')
  const [aMain, aPre = ''] = norm(a).split('-')
  const [bMain, bPre = ''] = norm(b).split('-')
  const aParts = aMain.split('.').map((n) => parseInt(n, 10) || 0)
  const bParts = bMain.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const av = aParts[i] || 0
    const bv = bParts[i] || 0
    if (av !== bv) return av - bv
  }
  // Pre-release: anything with a pre tag is older than the same version
  // without one. Otherwise lexicographic compare.
  if (aPre && !bPre) return -1
  if (!aPre && bPre) return 1
  if (aPre && bPre) return aPre.localeCompare(bPre)
  return 0
}

function pickAssetForPlatform(assets) {
  if (!Array.isArray(assets)) return null
  if (process.platform === 'win32') {
    return assets.find((a) => /AAELink-Setup-.*\.exe$/i.test(a.name)) || null
  }
  if (process.platform === 'darwin') {
    // Prefer arch-specific .dmg if present, else first .dmg
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const archMatch = assets.find((a) => a.name.endsWith('.dmg') && a.name.includes(arch))
    if (archMatch) return archMatch
    return assets.find((a) => a.name.endsWith('.dmg')) || null
  }
  return null
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `AAELink-Desktop/${app.getVersion()}`,
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location).then(resolve, reject)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          res.resume()
          return
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')))
  })
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `AAELink-Desktop/${app.getVersion()}`,
          Accept: 'application/octet-stream',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          file.close()
          fs.unlink(destPath, () => {})
          downloadFile(res.headers.location, destPath).then(resolve, reject)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          res.resume()
          file.close()
          fs.unlink(destPath, () => {})
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(destPath)))
      },
    )
    req.on('error', (err) => {
      file.close()
      fs.unlink(destPath, () => {})
      reject(err)
    })
    req.setTimeout(10 * 60_000, () => req.destroy(new Error('download timeout')))
  })
}

async function applyUpdate(installerPath) {
  if (process.platform === 'win32') {
    log('launching NSIS installer:', installerPath)
    const child = spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore' })
    child.unref()
    setTimeout(() => app.quit(), 1500)
    return
  }
  if (process.platform === 'darwin') {
    // Without a notarized auto-installer, the safest seamless behavior is to
    // open the .dmg in Finder so the user can drag-replace; we keep this
    // minimal until code signing is in place.
    log('opening dmg:', installerPath)
    await shell.openPath(installerPath)
    return
  }
}

async function checkOnce() {
  if (!app.isPackaged) {
    log('skip: not packaged (dev)')
    return
  }
  if (process.env.AAELINK_DISABLE_UPDATER === '1') {
    log('skip: disabled by env')
    return
  }
  try {
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`)
    const latest = release && release.tag_name
    const current = `v${app.getVersion()}`
    if (!latest) {
      log('no latest release found')
      return
    }
    if (compareVersions(latest, current) <= 0) {
      log(`up to date (${current} >= ${latest})`)
      return
    }
    const asset = pickAssetForPlatform(release.assets)
    if (!asset) {
      log('no compatible installer asset for', process.platform, process.arch)
      return
    }
    const tmp = path.join(app.getPath('temp'), asset.name)
    log(`downloading ${asset.name} (${latest}) -> ${tmp}`)
    await downloadFile(asset.browser_download_url, tmp)
    log('download complete; applying update')
    await applyUpdate(tmp)
  } catch (err) {
    log('check failed:', err && err.message ? err.message : err)
  }
}

function start() {
  setTimeout(() => { checkOnce() }, CHECK_DELAY_MS)
  setInterval(() => { checkOnce() }, RECHECK_INTERVAL_MS)
}

module.exports = { start, checkOnce, compareVersions }
