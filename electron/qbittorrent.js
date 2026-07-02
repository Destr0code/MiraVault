const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { app } = require('electron')
const { getStore } = require('./storeHelper')
const { listLibrary } = require('./library')

const LEGACY_DEFAULT_SERIES_DOWNLOAD_PATH = path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), 'Downloads', 'series')

const DEFAULT_CONFIG = {
  mode: 'external',
  url: 'http://localhost:8080',
  managedUrl: 'http://127.0.0.1:18080',
  managedPort: 18080,
  username: 'admin',
  password: 'admin123',
  seriesDownloadPath: ''
}

let session = {
  cookie: '',
  url: ''
}
let managedProcess = null

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_CONFIG.url).replace(/\/+$/, '')
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactCompare(value) {
  return normalizeCompare(value).replace(/\s+/g, '')
}

function stripReleaseTokens(value) {
  return cleanText(value)
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\b[Ss]\d{1,2}[Ee]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}x\d{1,2}\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|x264|x265|h264|h265|webrip|web dl|webdl|bluray|bdrip|hdrip|dvdrip|remux|proper|repack|multi|dual|vose|castellano|espanol|español|eng|aac|dts|ac3|eac3|sub|subs)\b/gi, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNameFromMagnet(value) {
  try {
    const query = String(value || '').split('?')[1] || ''
    const params = new URLSearchParams(query)
    return params.get('dn') || ''
  } catch {
    return ''
  }
}

function extractRawCandidateNames({ magnetOrUrl, torrentFiles } = {}) {
  const candidates = []
  const value = String(magnetOrUrl || '').trim()

  if (value) {
    if (value.startsWith('magnet:')) {
      candidates.push(extractNameFromMagnet(value))
    } else {
      try {
        const url = new URL(value)
        candidates.push(path.basename(decodeURIComponent(url.pathname || '')))
      } catch {
        candidates.push(path.basename(value))
      }
    }
  }

  for (const filePath of Array.isArray(torrentFiles) ? torrentFiles : []) {
    candidates.push(path.basename(filePath, path.extname(filePath)))
  }

  return candidates.map(cleanText).filter(Boolean)
}

function extractCandidateNames(payload = {}) {
  return extractRawCandidateNames(payload)
    .map(stripReleaseTokens)
    .filter(Boolean)
}

function namesMatch(left, right) {
  const leftNormal = normalizeCompare(left)
  const rightNormal = normalizeCompare(right)
  const leftCompact = compactCompare(left)
  const rightCompact = compactCompare(right)

  if (!leftNormal || !rightNormal) return false
  return (
    leftNormal === rightNormal ||
    leftNormal.startsWith(`${rightNormal} `) ||
    rightNormal.startsWith(`${leftNormal} `) ||
    leftNormal.includes(` ${rightNormal} `) ||
    rightNormal.includes(` ${leftNormal} `) ||
    (leftCompact.length >= 4 && rightCompact.length >= 4 && (
      leftCompact === rightCompact ||
      leftCompact.startsWith(rightCompact) ||
      rightCompact.startsWith(leftCompact)
    ))
  )
}

function looksLikeSeriesRelease(payload = {}) {
  const rawNames = extractRawCandidateNames(payload)
  return rawNames.some((name) => (
    /\b[Ss]\d{1,2}[Ee]\d{1,2}\b/.test(name) ||
    /\b\d{1,2}x\d{1,2}\b/i.test(name) ||
    /\b(season|temporada|capitulo|episodio|episode)\b/i.test(name)
  ))
}

function ensureDirectory(directory) {
  if (!directory) return ''
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function findExistingSeriesFolder(seriesRoot, candidates) {
  if (!seriesRoot || candidates.length === 0 || !fs.existsSync(seriesRoot)) return ''

  try {
    const folders = fs.readdirSync(seriesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const scored = folders
      .map((folderName) => {
        const candidate = candidates.find((name) => namesMatch(name, folderName))
        if (!candidate) return null
        return {
          folderName,
          score: compactCompare(folderName).length + (normalizeCompare(candidate).startsWith(normalizeCompare(folderName)) ? 20 : 0)
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)

    return scored[0] ? path.join(seriesRoot, scored[0].folderName) : ''
  } catch {
    return ''
  }
}

function getItemFilePaths(item) {
  const paths = []
  if (Array.isArray(item?.files)) {
    paths.push(...item.files.map((entry) => entry.path).filter(Boolean))
  }
  if (Array.isArray(item?.seasons)) {
    for (const season of item.seasons) {
      if (Array.isArray(season.episodes)) {
        paths.push(...season.episodes.map((episode) => episode.filePath).filter(Boolean))
      }
    }
  }
  return [...new Set(paths)]
}

function commonDirectory(paths) {
  const dirs = paths.map((entry) => path.dirname(entry)).filter(Boolean)
  if (dirs.length === 0) return ''
  if (dirs.length === 1) return maybeSeriesRoot(dirs[0])

  const splitDirs = dirs.map((dir) => path.resolve(dir).split(path.sep))
  const first = splitDirs[0]
  const common = []

  for (let index = 0; index < first.length; index += 1) {
    const part = first[index]
    if (splitDirs.every((entry) => entry[index]?.toLowerCase() === part.toLowerCase())) {
      common.push(part)
    } else {
      break
    }
  }

  return common.length > 0 ? common.join(path.sep) : maybeSeriesRoot(dirs[0])
}

function maybeSeriesRoot(directory) {
  const base = path.basename(directory).toLowerCase()
  if (/^(s|season|temporada)[ ._-]?\d{1,2}$/.test(base)) return path.dirname(directory)
  return directory
}

async function resolveAutoSavePath(payload = {}) {
  const explicitPath = cleanText(payload.savePath)
  if (explicitPath) return { savePath: explicitPath, matched: null }

  const config = await getConfig()
  const seriesRoot = cleanText(config.seriesDownloadPath)
  const candidates = extractCandidateNames(payload)
  if (candidates.length === 0) return { savePath: '', matched: null }

  const items = await listLibrary()

  const scored = items
    .map((item) => {
      const title = cleanText(item.title)
      if (!title) return null
      const matchedName = candidates.find((candidate) => namesMatch(candidate, title))
      if (!matchedName) return null

      const filePaths = getItemFilePaths(item)
      const savePath = commonDirectory(filePaths)
      if (!savePath) return null

      return {
        item,
        savePath,
        score: (item.type === 'series' ? 100 : 50) + title.length
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (best) {
    return {
      savePath: best.savePath,
      matched: {
        id: best.item.id,
        title: best.item.title,
        type: best.item.type,
        savePath: best.savePath
      }
    }
  }

  const existingSeriesFolder = findExistingSeriesFolder(seriesRoot, candidates)
  if (existingSeriesFolder) {
    return {
      savePath: existingSeriesFolder,
      matched: {
        id: `series-folder:${path.basename(existingSeriesFolder)}`,
        title: path.basename(existingSeriesFolder),
        type: 'series',
        savePath: existingSeriesFolder
      }
    }
  }

  if (looksLikeSeriesRelease(payload) && seriesRoot) {
    return {
      savePath: ensureDirectory(seriesRoot),
      matched: {
        id: 'series-root',
        title: 'carpeta de series',
        type: 'series-root',
        savePath: seriesRoot
      }
    }
  }

  return { savePath: '', matched: null }
}

async function getConfig() {
  const store = await getStore()
  const config = {
    ...DEFAULT_CONFIG,
    ...(store.get('qbittorrent') || {})
  }

  if (path.resolve(cleanText(config.seriesDownloadPath || '.')).toLowerCase() === path.resolve(LEGACY_DEFAULT_SERIES_DOWNLOAD_PATH).toLowerCase()) {
    config.seriesDownloadPath = ''
  }

  if (config.mode === 'managed' && !getManagedExecutable()) {
    config.mode = 'external'
  }

  return config
}

async function setConfig(config = {}) {
  const store = await getStore()
  const current = await getConfig()
  const next = {
    mode: config.mode === 'managed' ? 'managed' : 'external',
    url: normalizeBaseUrl(config.url || current.url),
    managedUrl: normalizeBaseUrl(config.managedUrl || current.managedUrl),
    managedPort: Number(config.managedPort || current.managedPort || DEFAULT_CONFIG.managedPort),
    username: String(config.username ?? current.username ?? ''),
    password: String(config.password ?? current.password ?? ''),
    seriesDownloadPath: cleanText(config.seriesDownloadPath ?? current.seriesDownloadPath ?? '')
  }

  if (next.mode === 'managed' && !getManagedExecutable()) {
    next.mode = 'external'
  }

  store.set('qbittorrent', next)
  session = { cookie: '', url: '' }
  return next
}

function getActiveUrl(config) {
  return normalizeBaseUrl(config.mode === 'managed' ? config.managedUrl : config.url)
}

function getManagedCandidates() {
  const roots = [
    path.join(process.resourcesPath || '', 'qbittorrent')
  ]

  return roots.flatMap((root) => [
    path.join(root, 'qbittorrent-engine.exe')
  ])
}

function getManagedExecutable() {
  return getManagedCandidates().find((candidate) => fs.existsSync(candidate)) || ''
}

function getManagedDataDir() {
  const base = app?.getPath ? app.getPath('userData') : path.join(process.cwd(), 'data')
  return path.join(base, 'qbittorrent-managed')
}

async function getEngineStatus() {
  const config = await getConfig()
  const executable = getManagedExecutable()
  return {
    mode: config.mode,
    activeUrl: getActiveUrl(config),
    managedAvailable: Boolean(executable),
    managedExecutable: executable,
    managedRunning: Boolean(managedProcess && !managedProcess.killed),
    managedPort: config.managedPort
  }
}

async function startManagedEngine() {
  const config = await getConfig()
  const executable = getManagedExecutable()

  if (!executable) {
    return {
      ok: false,
      error: 'No hay motor qBittorrent interno instalado. Usa qBittorrent externo o espera al motor WebTorrent interno.'
    }
  }

  if (managedProcess && !managedProcess.killed) {
    return { ok: true, alreadyRunning: true, executable }
  }

  const dataDir = getManagedDataDir()
  fs.mkdirSync(dataDir, { recursive: true })

  const args = [
    `--profile=${dataDir}`,
    `--webui-port=${config.managedPort}`
  ]

  try {
    managedProcess = spawn(executable, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true
    })
    managedProcess.unref()
    managedProcess.once('exit', () => {
      managedProcess = null
      session = { cookie: '', url: '' }
    })

    const startedAt = Date.now()
    while (Date.now() - startedAt < 15000) {
      const result = await pingActiveClient()
      if (result.ok) return { ok: true, executable, version: result.version }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return {
      ok: false,
      error: 'qBittorrent se lanzo, pero la WebUI no respondio. Puede que el binario no soporte --webui-port o necesite configuracion inicial.'
    }
  } catch (error) {
    managedProcess = null
    return { ok: false, error: error.message }
  }
}

async function stopManagedEngine() {
  if (!managedProcess || managedProcess.killed) return { ok: true }
  managedProcess.kill()
  managedProcess = null
  session = { cookie: '', url: '' }
  return { ok: true }
}

async function ensureManagedEngine() {
  const config = await getConfig()
  if (config.mode !== 'managed') return { ok: true }
  if (managedProcess && !managedProcess.killed) return { ok: true }
  return startManagedEngine()
}

async function request(endpoint, options = {}) {
  const config = await getConfig()
  const baseUrl = getActiveUrl(config)
  const url = `${baseUrl}${endpoint}`
  const headers = {
    Referer: baseUrl,
    ...(options.headers || {})
  }

  if (session.cookie && session.url === baseUrl) {
    headers.Cookie = session.cookie
  }

  let response = await fetch(url, {
    ...options,
    headers
  })

  if (response.status === 403 || response.status === 401) {
    await login()
    headers.Cookie = session.cookie
    response = await fetch(url, {
      ...options,
      headers
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `qBittorrent HTTP ${response.status}`)
  }

  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function login() {
  const config = await getConfig()
  const baseUrl = getActiveUrl(config)
  const body = new URLSearchParams({
    username: config.username,
    password: config.password
  })

  const response = await fetch(`${baseUrl}/api/v2/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: baseUrl
    },
    body
  })

  const text = await response.text().catch(() => '')
  const loginAccepted = response.status === 204 || /^ok\.?$/i.test(text.trim())
  if (!response.ok || !loginAccepted) {
    throw new Error('No se pudo iniciar sesion en qBittorrent.')
  }

  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('qBittorrent no devolvio cookie de sesion.')
  session = {
    cookie: cookie.split(';')[0],
    url: baseUrl
  }
  return true
}

async function ping() {
  try {
    const managed = await ensureManagedEngine()
    if (!managed.ok) return managed
    return pingActiveClient()
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function pingActiveClient() {
  try {
    await login()
    const version = await request('/api/v2/app/version')
    return { ok: true, version }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function listTorrents(filter = 'all') {
  try {
    const managed = await ensureManagedEngine()
    if (!managed.ok) return []
    await login()
    const query = new URLSearchParams()
    if (filter && filter !== 'all') query.set('filter', filter)
    const items = await request(`/api/v2/torrents/info${query.toString() ? `?${query}` : ''}`)
    return Array.isArray(items) ? items : []
  } catch {
    return []
  }
}

async function getTransferInfo() {
  try {
    const managed = await ensureManagedEngine()
    if (!managed.ok) return null
    await login()
    return await request('/api/v2/transfer/info')
  } catch {
    return null
  }
}

async function addTorrent({ magnetOrUrl, torrentFiles, savePath, category } = {}) {
  const value = String(magnetOrUrl || '').trim()
  const files = Array.isArray(torrentFiles) ? torrentFiles.filter(Boolean) : []
  if (!value && files.length === 0) return { ok: false, error: 'Pega un magnet/URL o selecciona un archivo .torrent.' }

  try {
    const managed = await ensureManagedEngine()
    if (!managed.ok) return managed
    await login()
    const autoTarget = await resolveAutoSavePath({ magnetOrUrl: value, torrentFiles: files, savePath })
    const form = new FormData()
    if (value) form.append('urls', value)
    for (const filePath of files) {
      const data = fs.readFileSync(filePath)
      const blob = new Blob([data], { type: 'application/x-bittorrent' })
      form.append('torrents', blob, path.basename(filePath))
    }
    if (autoTarget.savePath) form.append('savepath', autoTarget.savePath)
    if (category) form.append('category', category)
    form.append('paused', 'false')
    form.append('autoTMM', 'false')

    await request('/api/v2/torrents/add', {
      method: 'POST',
      body: form
    })

    return { ok: true, savePath: autoTarget.savePath, matched: autoTarget.matched }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function pauseTorrent(hash) {
  return torrentCommand('/api/v2/torrents/pause', hash)
}

async function resumeTorrent(hash) {
  return torrentCommand('/api/v2/torrents/resume', hash)
}

async function deleteTorrent({ hash, deleteFiles = false } = {}) {
  if (!hash) return { ok: false, error: 'Falta hash.' }
  try {
    const managed = await ensureManagedEngine()
    if (!managed.ok) return managed
    await login()
    const body = new URLSearchParams({
      hashes: hash,
      deleteFiles: String(Boolean(deleteFiles))
    })
    await request('/api/v2/torrents/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function torrentCommand(endpoint, hash) {
  if (!hash) return { ok: false, error: 'Falta hash.' }
  try {
    const managed = await ensureManagedEngine()
    if (!managed.ok) return managed
    await login()
    const body = new URLSearchParams({ hashes: hash })
    await request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function getTorrentContentRoot(torrent) {
  const savePath = torrent?.save_path || torrent?.savePath || ''
  const name = torrent?.name || ''
  if (!savePath) return ''
  return path.join(savePath, name)
}

module.exports = {
  getConfig,
  setConfig,
  getEngineStatus,
  startManagedEngine,
  stopManagedEngine,
  ping,
  listTorrents,
  getTransferInfo,
  addTorrent,
  pauseTorrent,
  resumeTorrent,
  deleteTorrent,
  getTorrentContentRoot
}
