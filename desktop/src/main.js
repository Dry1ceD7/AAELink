// AAELink Desktop — minimal Electron shell.
// Loads the configured AAELink server URL in a native window so the desktop
// app behaves like a thin client against a hosted backend (e.g. the temporary
// MacBook Docker server on the LAN).

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const updater = require('./updater')
const secureStore = require('./secure-store')

// White-label every layer that surfaces a process name so the OS, Dock,
// menu bar, Activity Monitor, and `ps` all show "AAELink" instead of the
// bundled Electron framework name (matters most when running `npm start`
// in dev mode; packaged builds also pick up productName/extendInfo).
app.setName('AAELink')
app.setAppUserModelId('com.aae.aaelink')
try { process.title = 'AAELink' } catch (_) { }

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const userDataDir = app.getPath('userData')
const configPath = path.join(userDataDir, 'config.json')
const iconPngPath = path.join(__dirname, '..', 'build', 'icon.png')
const appIcon = (() => {
  try {
    if (fs.existsSync(iconPngPath)) return nativeImage.createFromPath(iconPngPath)
  } catch (_) { }
  return undefined
})()

// Centralized Wi-Fi development server: AAELink desktop clients on the
// shared office network all point at the MacBook Docker host so they share
// one backend / database / files. Override with AAELINK_SERVER_URL when
// running against a different deployment.
const DEFAULT_SERVER_URL =
  process.env.AAELINK_SERVER_URL || 'http://192.168.11.73:18080'

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.serverUrl === 'string') return parsed
    }
  } catch (_) { }
  return { serverUrl: DEFAULT_SERVER_URL }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to persist config:', err)
  }
}

let mainWindow = null

function createWindow() {
  const cfg = loadConfig()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a2342',
    title: 'AAELink',
    icon: appIcon,
    show: false,
    // macOS: keep traffic-lights visible but pull the title bar into the
    // content area so we control the drag region from CSS in the page.
    // Windows: use the modern title-bar overlay so the chrome matches the
    // brand colours while still giving min/max/close + drag.
    titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    titleBarOverlay: isWin
      ? { color: '#0a2342', symbolColor: '#ffffff', height: 32 }
      : false,
    autoHideMenuBar: !isMac,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.loadURL(cfg.serverUrl).catch((err) => {
    console.error('Initial load failed:', err)
    showServerPrompt(true)
  })

  // After every navigation, inject a draggable strip that sits behind the
  // app's own header so users can grab the window anywhere along the top.
  // Buttons / inputs override the drag region with `-webkit-app-region: no-drag`
  // so they remain fully clickable (the AAELink frontend already does this
  // via its `.aaelink-no-drag` helper class).
  mainWindow.webContents.on('did-finish-load', () => {
    injectChrome(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

const dragBarHeight = isMac ? 28 : isWin ? 32 : 0

// Inject a fixed-height OS title bar drag strip + a CSS variable that the
// AAELink frontend reads to offset its app-shell containers. Without that
// offset every fixed `inset-0` surface (login, dashboard, slide-overs)
// would render UNDER the drag region and clicks on top-row controls would
// be swallowed by the drag handler. Using a CSS variable keeps the visible
// chrome in lock-step with the OS-reserved space across all routes.
function injectChrome(win) {
  if (!win || win.isDestroyed()) return
  if (dragBarHeight <= 0) return
  const css = `
    :root { --aae-titlebar-height: ${dragBarHeight}px; }
    html, body { padding-top: 0 !important; }
    /* App-shell surfaces opt-in via data-aae-shell so the drag strip is
       always rendered above them, never on top of clickable controls. */
    [data-aae-shell="true"] { top: var(--aae-titlebar-height, 0px) !important; }
    #aaelink-drag-region {
      position: fixed; top: 0; left: 0; right: 0;
      height: var(--aae-titlebar-height, 0px);
      -webkit-app-region: drag;
      app-region: drag;
      background: transparent;
      /* Sit just under the standard modal layer (z-50) so dialogs and
         dropdowns can fully cover it instead of being chopped at the top. */
      z-index: 40;
    }
    /* Anything interactive remains click-through even when it visually
       sits inside the drag strip's bounding rect. */
    button, a, input, select, textarea, label, [role="button"], [role="link"],
    [role="menuitem"], [role="tab"], .aaelink-no-drag {
      -webkit-app-region: no-drag;
      app-region: no-drag;
    }
  `
  win.webContents.insertCSS(css).catch(() => { })
  win.webContents
    .executeJavaScript(`(() => {
      if (!document.getElementById('aaelink-drag-region')) {
        const el = document.createElement('div');
        el.id = 'aaelink-drag-region';
        document.body.appendChild(el);
      }
    })();`)
    .catch(() => { })
}

async function showServerPrompt(initial) {
  const cfg = loadConfig()
  const result = await dialog.showMessageBox({
    type: 'question',
    title: initial ? 'Configure AAELink server' : 'Change AAELink server',
    message: initial
      ? 'Cannot reach the AAELink server. Enter the server URL provided by your administrator.'
      : 'Update the AAELink server URL.',
    detail: `Current: ${cfg.serverUrl}`,
    buttons: ['Open Settings File', 'Retry', 'Quit'],
    cancelId: 2,
    defaultId: 1,
  })
  if (result.response === 0) {
    shell.showItemInFolder(configPath)
  } else if (result.response === 1) {
    if (mainWindow) mainWindow.loadURL(loadConfig().serverUrl)
  } else {
    app.quit()
  }
}

function buildMenu() {
  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Configure Server URL...',
          click: () => showServerPrompt(false),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'AAELink on GitHub',
          click: () => shell.openExternal('https://github.com/Dry1ceD7/AAELink'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  if (!fs.existsSync(configPath)) saveConfig({ serverUrl: DEFAULT_SERVER_URL })
  if (isMac && app.dock && appIcon) {
    try { app.dock.setIcon(appIcon) } catch (_) { }
  }
  buildMenu()
  createWindow()
  try { updater.start() } catch (err) { console.error('updater start failed:', err) }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

ipcMain.handle('aaelink:get-config', () => loadConfig())
ipcMain.handle('aaelink:set-config', (_evt, cfg) => {
  saveConfig({ ...loadConfig(), ...cfg })
  return loadConfig()
})

ipcMain.handle('aaelink:secure-available', () => secureStore.isAvailable())
ipcMain.handle('aaelink:secure-get', (_evt, key) => secureStore.get(key))
ipcMain.handle('aaelink:secure-set', (_evt, key, value) => secureStore.set(key, value))
ipcMain.handle('aaelink:secure-del', (_evt, key) => secureStore.del(key))
ipcMain.handle('aaelink:secure-clear', () => secureStore.clear())
ipcMain.handle('aaelink:updater-check', async () => {
  try { await updater.checkOnce(); return { ok: true } } catch (err) {
    return { ok: false, error: String(err && err.message || err) }
  }
})
