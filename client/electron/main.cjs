/* eslint-disable */
const { app, BrowserWindow, shell, ipcMain, session, dialog, Menu } = require('electron')
const path = require('path')
const log = require('electron-log')

log.transports.file.level = 'info'

const isDev = !app.isPackaged
const devUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173'

let mainWindow = null
// electron-updater lazy-initializes on first access and reads app.getVersion()
// at require time — importing it before app is ready throws. Loaded inside
// wireAutoUpdater() instead.
let autoUpdater = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b12',
    title: 'ZoikoSema',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (isDev) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Open external links in the user's browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Allow camera, microphone and screen-capture prompts (required for meetings)
function wirePermissions() {
  const ALLOWED = new Set(['media', 'mediaKeySystem', 'display-capture', 'notifications'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(ALLOWED.has(permission))
  })
}

// ---------- Auto-updater ----------

function wireAutoUpdater() {
  if (isDev) {
    log.info('[updater] skipped in dev mode')
    return
  }

  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (e) {
    log.error('[updater] failed to load electron-updater', e)
    return
  }
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] checking for update')
    sendStatus('checking')
  })
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update available', info?.version)
    sendStatus('available', info)
  })
  autoUpdater.on('update-not-available', () => {
    log.info('[updater] up to date')
    sendStatus('not-available')
  })
  autoUpdater.on('download-progress', (p) => {
    sendStatus('progress', { percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] update downloaded', info?.version)
    sendStatus('downloaded', info)
    dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: `ZoikoSema ${info?.version || ''} is ready to install.`,
        detail: 'Restart the app to apply the update.',
      })
      .then((res) => {
        if (res.response === 0) autoUpdater.quitAndInstall()
      })
  })
  autoUpdater.on('error', (err) => {
    log.error('[updater] error', err)
    sendStatus('error', { message: String(err?.message || err) })
  })

  // Check on boot, then every 4 hours
  autoUpdater.checkForUpdatesAndNotify().catch((e) => log.error(e))
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => log.error(e))
  }, 4 * 60 * 60 * 1000)
}

function sendStatus(status, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('updater:status', { status, payload })
}

// Manual update check from renderer
ipcMain.handle('updater:check', async () => {
  if (isDev) return { ok: false, reason: 'dev' }
  if (!autoUpdater) return { ok: false, reason: 'updater-not-loaded' }
  try {
    const r = await autoUpdater.checkForUpdates()
    return { ok: true, version: r?.updateInfo?.version }
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) }
  }
})
ipcMain.handle('updater:quit-and-install', () => {
  if (autoUpdater) autoUpdater.quitAndInstall()
})
ipcMain.handle('app:version', () => app.getVersion())

// ---------- Lifecycle ----------

// Enforce single instance — focus existing window if a second is launched
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    wirePermissions()
    createWindow()
    wireAutoUpdater()

    if (process.platform === 'darwin') {
      // Keep a minimal native menu on macOS
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]))
    } else {
      Menu.setApplicationMenu(null)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
 