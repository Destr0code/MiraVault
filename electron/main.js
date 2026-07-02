const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile, spawn } = require('child_process')
const { getStore } = require('./storeHelper')
const {
  getProgress,
  updateProgress,
  markWatched,
  markUnwatched,
  getAllProgress,
  clearAllProgress
} = require('./tracker')
const {
  listLibrary,
  getLibraryItem,
  getLibrarySources,
  importPaths,
  removeLibraryItem,
  removeLibrarySource,
  clearLibrary,
  rescanLibrary,
  getLibraryStats,
  updateMetadataOverride,
  clearMetadataOverride,
  searchLibraryMetadataOptions,
  previewOrganizeSeriesFolder,
  organizeSeriesFolder
} = require('./library')
const {
  openTrackedPlayback,
  stopTrackedPlayback,
  commandTrackedPlayback,
  getVlcPath
} = require('./mpvPlayer')
const qbittorrent = require('./qbittorrent')
const torrentEngine = require('./torrentEngine')
const iptvBridge = require('./iptvBridge')
const { listSubtitles, resolveSubtitle } = require('./subtitles')
const { getEpisodeMetadata } = require('./episodeMetadata')
const {
  checkForUpdates,
  dismissUpdateVersion,
  getVersionNotice,
  markVersionNoticeSeen
} = require('./releaseInfo')

const isDev = !app.isPackaged

// El reproductor interno usa <video> de Chromium. En algunos equipos/formatos
// aparecen artefactos al hacer seek con decodificacion por GPU.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-zero-copy')

let mainWindow

function getWindowIconPath() {
  const candidates = [
    path.join(__dirname, '../dist/icon.ico'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(process.cwd(), 'public/icon.ico')
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || undefined
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    icon: getWindowIconPath(),
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

const DEFAULTS = {
  theme: 'dark-blue'
}

function isNetworkMediaUrl(value) {
  return /^(https?|rtp|udp|rtsp):\/\//i.test(String(value || '').trim())
}

function getVlcArgs(targetPath, startTime = 0, subtitlePath = '') {
  const args = []
  if (isNetworkMediaUrl(targetPath)) {
    args.push(
      '--avcodec-hw=none',
      '--network-caching=3000',
      '--live-caching=3000',
      '--clock-jitter=0'
    )
  }

  if (Number(startTime) > 0) args.push('--start-time=' + Math.floor(Number(startTime) || 0))
  if (subtitlePath && fs.existsSync(subtitlePath)) args.push('--sub-file=' + subtitlePath)
  args.push(targetPath)
  return args
}

function runOrganizerWorker(action, rootPath, timeoutMs) {
  return new Promise((resolve) => {
    const workerPath = path.join(__dirname, 'organizerWorker.js')
    const child = spawn(process.execPath, [workerPath, action, rootPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({
        ok: false,
        error: 'La carpeta tarda demasiado en responder. Prueba con una subcarpeta mas concreta o revisa la unidad.',
        items: [],
        timedOut: true
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve({ ok: false, error: error.message, items: [] })
    })
    child.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      try {
        resolve(JSON.parse(stdout || '{}'))
      } catch {
        resolve({
          ok: false,
          error: stderr || stdout || 'El organizador no devolvio una respuesta valida.',
          items: []
        })
      }
    })
  })
}

async function collectSupportInfo() {
  const store = await getStore()
  const [stats, sources] = await Promise.all([
    getLibraryStats().catch(() => null),
    getLibrarySources().catch(() => [])
  ])

  return {
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    paths: {
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      logs: app.getPath('logs')
    },
    player: {
      playerPath: store.get('playerPath', ''),
      playerName: store.get('playerName', '')
    },
    library: {
      stats,
      sources: Array.isArray(sources) ? sources.map((source) => source.path || source.sourcePath || source) : []
    },
    preferences: {
      theme: store.get('theme', DEFAULTS.theme)
    },
    generatedAt: new Date().toISOString()
  }
}

app.whenReady().then(async () => {
  createWindow()
})

app.on('window-all-closed', async () => {
  await iptvBridge.stopBridge().catch(() => {})
  app.quit()
})

// IPC: ventana
ipcMain.on('win:minimize', () => mainWindow?.minimize())
ipcMain.on('win:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())
ipcMain.on('win:close', () => mainWindow?.close())

// IPC: dialogos
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:selectMediaFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Video',
        extensions: ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'ts']
      }
    ]
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('dialog:selectTorrentFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Torrent', extensions: ['torrent'] }
    ]
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('shell:openFolder', (_, targetPath) => shell.openPath(targetPath))
ipcMain.handle('shell:openPath', (_, targetPath) => shell.openPath(targetPath))
ipcMain.handle('shell:openExternal', (_, targetUrl) => shell.openExternal(String(targetUrl || '')))
ipcMain.handle('media:trashPath', async (_, targetPath) => {
  const resolvedPath = path.resolve(String(targetPath || ''))
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return { ok: false, error: 'La ruta no existe.' }

  try {
    await shell.trashItem(resolvedPath)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message || 'No se pudo mover a la papelera.' }
  }
})

ipcMain.handle('app:getVersionNotice', () => getVersionNotice())
ipcMain.handle('app:markVersionNoticeSeen', (_, version) => markVersionNoticeSeen(version))
ipcMain.handle('app:checkForUpdates', () => checkForUpdates())
ipcMain.handle('app:dismissUpdateVersion', (_, version) => dismissUpdateVersion(version))
ipcMain.handle('app:getSupportInfo', () => collectSupportInfo())
ipcMain.handle('app:copySupportInfo', async () => {
  const info = await collectSupportInfo()
  clipboard.writeText(JSON.stringify(info, null, 2))
  return { ok: true, info }
})

ipcMain.handle('iptv:fetchPlaylist', async (_, url) => {
  const targetUrl = String(url || '').trim()
  if (!/^https?:\/\//i.test(targetUrl)) return { ok: false, error: 'URL IPTV no valida.' }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'MiraVault/1.0 IPTV',
        Accept: 'application/x-mpegURL, audio/mpegurl, text/plain, */*'
      }
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const text = await response.text()
    return { ok: true, text }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})
ipcMain.handle('iptv:startBridge', async (_, url) => iptvBridge.startBridge(url))
ipcMain.handle('iptv:stopBridge', async () => iptvBridge.stopBridge())
ipcMain.handle('iptv:getBridgeDebug', async () => iptvBridge.getDebug())

// IPC: config
ipcMain.handle('config:getTheme', async () => (await getStore()).get('theme', DEFAULTS.theme))
ipcMain.handle('config:setTheme', async (_, value) => { (await getStore()).set('theme', value); return true })

// IPC: biblioteca local
ipcMain.handle('library:list', async () => listLibrary())
ipcMain.handle('library:getItem', async (_, id) => getLibraryItem(id))
ipcMain.handle('library:getSources', async () => getLibrarySources())
ipcMain.handle('library:getStats', async () => getLibraryStats())
ipcMain.handle('library:importPaths', async (_, pathsToImport) => importPaths(pathsToImport))
ipcMain.handle('library:rescan', async () => rescanLibrary())
ipcMain.handle('library:removeItem', async (_, id) => removeLibraryItem(id))
ipcMain.handle('library:removeSource', async (_, sourcePath) => removeLibrarySource(sourcePath))
ipcMain.handle('library:clear', async () => clearLibrary())
ipcMain.handle('library:updateMetadataOverride', async (_, payload = {}) => updateMetadataOverride(payload.id, payload.data || {}))
ipcMain.handle('library:clearMetadataOverride', async (_, id) => clearMetadataOverride(id))
ipcMain.handle('library:searchMetadataOptions', async (_, id) => searchLibraryMetadataOptions(id))
ipcMain.handle('library:previewOrganizeSeriesFolder', async (_, rootPath) => {
  try {
    return await runOrganizerWorker('preview', rootPath, 70000)
  } catch (error) {
    console.error('[organizer] preview:error', error)
    return { ok: false, error: error.message || 'No se pudo analizar la carpeta.', items: [] }
  }
})
ipcMain.handle('library:organizeSeriesFolder', async (_, rootPath) => {
  try {
    return await runOrganizerWorker('organize', rootPath, 180000)
  } catch (error) {
    console.error('[organizer] organize:error', error)
    return { ok: false, error: error.message || 'No se pudo ordenar la carpeta.', items: [] }
  }
})

// IPC: progreso de visualizacion
ipcMain.handle('watch:getAll', async () => getAllProgress())
ipcMain.handle('watch:getProgress', async (_, key) => getProgress(key))
ipcMain.handle('watch:update', async (_, { key, data }) => updateProgress(key, data))
ipcMain.handle('watch:markWatched', async (_, key) => markWatched(key))
ipcMain.handle('watch:markUnwatched', async (_, key) => markUnwatched(key))
ipcMain.handle('watch:clearAll', async () => clearAllProgress())

ipcMain.handle('subtitles:list', async (_, payload = {}) => listSubtitles(payload || {}))
ipcMain.handle('subtitles:resolve', async (_, payload = {}) => resolveSubtitle(payload || {}))
ipcMain.handle('episode:metadata', async (_, payload = {}) => getEpisodeMetadata(payload || {}))

ipcMain.handle('player:open', async (_, filePath, startTime, payload = {}) => {
  const store = await getStore()
  const detectedVlc = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'
  const playerExe = store.get('playerPath', '') || (fs.existsSync(detectedVlc) ? detectedVlc : '')
  const playerName = ((await getStore()).get('playerName', '') || '').toLowerCase()

  try {
    let args = [filePath]
    let resumed = false
    const subtitleResult = await resolveSubtitle({ ...payload, filePath }).catch(() => ({ subtitle: null }))
    const subtitlePath = subtitleResult?.subtitle?.path || ''

    if (playerExe && fs.existsSync(playerExe)) {
      // Intentar pasar startTime segun el reproductor configurado
      if (startTime > 0) {
        const name = `${path.basename(playerExe, '.exe')} ${playerName}`.toLowerCase()
        const seconds = Math.floor(Number(startTime) || 0)
        const hh = String(Math.floor(seconds / 3600)).padStart(2, '0')
        const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
        const ss = String(seconds % 60).padStart(2, '0')
        const clock = `${hh}:${mm}:${ss}`

        if (name.includes('vlc')) {
          args = getVlcArgs(filePath, seconds, subtitlePath)
          resumed = true
        } else if (name.includes('mpc') || name.includes('mpc-hc') || name.includes('mpc-be')) {
          args = [filePath, '/startpos', clock]
          resumed = true
        } else if (name.includes('potplayer') || name.includes('pot')) {
          args = ['/seek=' + clock, filePath]
          resumed = true
        } else if (name.includes('mpv')) {
          args = ['--start=' + seconds, filePath]
          resumed = true
        }
      } else if (`${path.basename(playerExe, '.exe')} ${playerName}`.toLowerCase().includes('vlc')) {
        args = getVlcArgs(filePath, 0, subtitlePath)
      }

      execFile(playerExe, args, { detached: true })
    } else {
      await shell.openPath(filePath)
    }
    return { ok: true, resumed: startTime > 0 ? resumed : null, subtitle: subtitleResult?.subtitle || null }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('player:openTracked', async (_, payload) => openTrackedPlayback(payload || {}, mainWindow))
ipcMain.handle('player:stopTracked', async () => stopTrackedPlayback())
ipcMain.handle('player:commandTracked', async (_, payload = {}) => commandTrackedPlayback(payload.action, payload.value))
ipcMain.handle('player:getTrackedStatus', async () => {
  const executable = await getVlcPath()
  return { available: Boolean(executable), executable }
})

ipcMain.handle('player:findFile', async (_, { savePath }) => {
  const videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v']

  function findVideos(dir) {
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    let files = []

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) files = files.concat(findVideos(full))
      else if (videoExts.includes(path.extname(entry.name).toLowerCase())) {
        files.push({ path: full, size: fs.statSync(full).size })
      }
    }

    return files
  }

  const videos = findVideos(savePath)
  if (!videos.length) return null
  return videos.sort((a, b) => b.size - a.size)[0].path
})

ipcMain.handle('player:selectExe', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar reproductor de video',
    filters: [{ name: 'Ejecutables', extensions: ['exe'] }],
    properties: ['openFile']
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('player:getConfig', async () => ({
  playerPath: (await getStore()).get('playerPath', ''),
  playerName: (await getStore()).get('playerName', '')
}))

ipcMain.handle('player:saveConfig', async (_, { playerPath, playerName }) => {
  const store = await getStore()
  store.set('playerPath', playerPath)
  store.set('playerName', playerName)
  return true
})

// IPC: torrent engine generico
ipcMain.handle('torrent:getConfig', async () => torrentEngine.getConfig())
ipcMain.handle('torrent:setConfig', async (_, config) => torrentEngine.setConfig(config))
ipcMain.handle('torrent:engineStatus', async () => torrentEngine.getEngineStatus())
ipcMain.handle('torrent:ping', async () => torrentEngine.ping())
ipcMain.handle('torrent:list', async (_, filter) => torrentEngine.listTorrents(filter))
ipcMain.handle('torrent:transferInfo', async () => torrentEngine.getTransferInfo())
ipcMain.handle('torrent:add', async (_, payload) => torrentEngine.addTorrent(payload || {}))
ipcMain.handle('torrent:pause', async (_, id) => torrentEngine.pauseTorrent(id))
ipcMain.handle('torrent:resume', async (_, id) => torrentEngine.resumeTorrent(id))
ipcMain.handle('torrent:delete', async (_, payload) => torrentEngine.deleteTorrent(payload || {}))
ipcMain.handle('torrent:openContent', async (_, torrent) => torrentEngine.openContent(torrent))
ipcMain.handle('torrent:importContent', async (_, torrent) => torrentEngine.importContent(torrent))

// IPC: qBittorrent externo (compatibilidad)
ipcMain.handle('qbittorrent:getConfig', async () => qbittorrent.getConfig())
ipcMain.handle('qbittorrent:setConfig', async (_, config) => qbittorrent.setConfig(config))
ipcMain.handle('qbittorrent:engineStatus', async () => qbittorrent.getEngineStatus())
ipcMain.handle('qbittorrent:startManaged', async () => qbittorrent.startManagedEngine())
ipcMain.handle('qbittorrent:stopManaged', async () => qbittorrent.stopManagedEngine())
ipcMain.handle('qbittorrent:ping', async () => qbittorrent.ping())
ipcMain.handle('qbittorrent:list', async (_, filter) => qbittorrent.listTorrents(filter))
ipcMain.handle('qbittorrent:transferInfo', async () => qbittorrent.getTransferInfo())
ipcMain.handle('qbittorrent:add', async (_, payload) => qbittorrent.addTorrent(payload || {}))
ipcMain.handle('qbittorrent:pause', async (_, hash) => qbittorrent.pauseTorrent(hash))
ipcMain.handle('qbittorrent:resume', async (_, hash) => qbittorrent.resumeTorrent(hash))
ipcMain.handle('qbittorrent:delete', async (_, payload) => qbittorrent.deleteTorrent(payload || {}))
ipcMain.handle('qbittorrent:openContent', async (_, torrent) => {
  const targetPath = qbittorrent.getTorrentContentRoot(torrent)
  const fallbackPath = torrent?.save_path || ''
  const existingPath = targetPath && fs.existsSync(targetPath) ? targetPath : fallbackPath
  if (!existingPath) return { ok: false, error: 'No se pudo resolver la ruta.' }
  const openResult = await shell.openPath(existingPath)
  return openResult ? { ok: false, error: openResult } : { ok: true }
})
ipcMain.handle('qbittorrent:importContent', async (_, torrent) => {
  const targetPath = qbittorrent.getTorrentContentRoot(torrent)
  const fallbackPath = torrent?.save_path || ''
  const existingPath = targetPath && fs.existsSync(targetPath) ? targetPath : fallbackPath
  if (!existingPath || !fs.existsSync(existingPath)) return { ok: false, error: 'La ruta descargada todavia no existe.' }
  const imported = await importPaths([existingPath])
  return { ok: true, imported }
})
