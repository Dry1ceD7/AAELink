// AAELink Desktop — minimal Electron shell.
// Loads the configured AAELink server URL in a native window so the desktop
// app behaves like a thin client against a hosted backend (e.g. the temporary
// MacBook Docker server on the LAN).

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const isMac = process.platform === 'darwin'
const userDataDir = app.getPath('userData')
const configPath = path.join(userDataDir, 'config.json')

const DEFAULT_SERVER_URL = process.env.AAELINK_SERVER_URL || 'http://localhost:18080'

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.serverUrl === 'string') return parsed
    }
  } catch (_) {}
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
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    autoHideMenuBar: !isMac,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.loadURL(cfg.serverUrl).catch((err) => {
    console.error('Initial load failed:', err)
    showServerPrompt(true)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
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
  buildMenu()
  createWindow()
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
