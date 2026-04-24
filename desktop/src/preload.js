// AAELink desktop preload bridge.
// Exposes a tiny, safe API to the renderer (the AAELink web UI loaded over
// HTTP). Renderer code can detect `window.aaelink` to enable desktop-only
// features like OS-protected "Remember me" storage.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aaelink', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions,

  config: {
    get: () => ipcRenderer.invoke('aaelink:get-config'),
    set: (cfg) => ipcRenderer.invoke('aaelink:set-config', cfg),
  },

  secure: {
    available: () => ipcRenderer.invoke('aaelink:secure-available'),
    get: (key) => ipcRenderer.invoke('aaelink:secure-get', key),
    set: (key, value) => ipcRenderer.invoke('aaelink:secure-set', key, value),
    del: (key) => ipcRenderer.invoke('aaelink:secure-del', key),
    clear: () => ipcRenderer.invoke('aaelink:secure-clear'),
  },

  updater: {
    check: () => ipcRenderer.invoke('aaelink:updater-check'),
  },
})
