const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { shell } = require('electron')
const { enrichMetadata, searchMetadataOptions } = require('./metadata')
const { getStore } = require('./storeHelper')

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.ts'])
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub'])
const BOOK_EXTENSIONS = new Set(['.epub', '.pdf', '.mobi', '.azw3', '.cbz', '.cbr'])
const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...BOOK_EXTENSIONS])
const DISPOSABLE_EXTENSIONS = new Set(['.torrent', '.nfo', '.txt', '.url', '.lnk', '.sfv', '.srr', '.idx'])
const ARCHIVE_EXTENSIONS = new Set(['.rar', '.zip', '.7z', '.tar', '.gz', '.bz2', '.xz'])
const DISPOSABLE_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store'])
const PARTIAL_EXTENSIONS = new Set(['.!qb', '.part', '.crdownload', '.download', '.tmp', '.!ut'])
const RELEASE_WORDS = [
  '2160p', '1440p', '1080p', '720p', '576p', '480p', '4k', 'uhd', 'hdr', 'hdr10', 'dv',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', '10bit', '8bit',
  'web', 'webdl', 'web-dl', 'webrip', 'bluray', 'blu-ray', 'bdrip', 'brrip', 'hdrip', 'hdtv', 'dvdrip',
  'remux', 'proper', 'repack', 'extended', 'internal', 'complete',
  'multi', 'dual', 'vose', 'castellano', 'espanol', 'español', 'spanish', 'english', 'latino',
  'aac', 'dts', 'ac3', 'eac3', 'ddp', 'atmos', 'subs', 'subbed'
]

function organizerDebug(...args) {
  if (process.env.MIRAVAULT_ORGANIZER_DEBUG === '1') {
    const payload = args.length === 1 ? args[0] : args
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    console.error(`[library-organizer ${new Date().toISOString()}] ${text}`)
  }
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

function safeName(value) {
  return cleanText(value).replace(/[<>:"/\\|?*]+/g, '').replace(/\.+$/g, '').trim()
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function ensureStringArray(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  return cleanText(value).split(',').map(cleanText).filter(Boolean)
}

async function getLibraryState() {
  const store = await getStore()
  return store.get('libraryState', {
    items: [],
    sources: [],
    updatedAt: null
  })
}

async function saveLibraryState(state) {
  const store = await getStore()
  store.set('libraryState', state)
}

async function getMetadataOverrides() {
  const store = await getStore()
  return store.get('metadataOverrides', {})
}

async function saveMetadataOverrides(overrides) {
  const store = await getStore()
  store.set('metadataOverrides', overrides || {})
}

function sanitizeMetadataOverride(data = {}) {
  const override = {}
  const stringFields = ['imdbId', 'title', 'year', 'poster', 'synopsis', 'duration', 'director', 'rating']
  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) override[field] = cleanText(data[field])
  }
  if (Object.prototype.hasOwnProperty.call(data, 'genres')) override.genres = ensureStringArray(data.genres)
  if (Object.prototype.hasOwnProperty.call(data, 'cast')) override.cast = ensureStringArray(data.cast)
  override.manualOverride = true
  override.updatedAt = Date.now()
  return override
}

function applyMetadataOverride(item, overrides = {}) {
  const override = overrides[item.id]
  if (!override) return item
  return {
    ...item,
    ...override,
    id: item.id,
    type: item.type,
    files: item.files,
    seasons: item.seasons,
    totalSize: item.totalSize,
    manualOverride: true
  }
}

function statSafe(targetPath) {
  try {
    return fs.statSync(targetPath)
  } catch {
    return null
  }
}

function pathExists(targetPath) {
  return Boolean(statSafe(targetPath))
}

function walkMediaFiles(entryPath, bucket, visited = new Set()) {
  const resolved = path.resolve(entryPath)
  if (visited.has(resolved)) return
  visited.add(resolved)

  const stats = statSafe(resolved)
  if (!stats) return

  if (stats.isFile()) {
    const ext = path.extname(resolved).toLowerCase()
    if (MEDIA_EXTENSIONS.has(ext)) {
      bucket.push({
        path: resolved,
        size: stats.size,
        modifiedAt: stats.mtimeMs
      })
    }
    return
  }

  if (!stats.isDirectory()) return

  let entries = []
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    walkMediaFiles(path.join(resolved, entry.name), bucket, visited)
  }
}

function walkAllFiles(entryPath, bucket, visited = new Set()) {
  const resolved = path.resolve(entryPath)
  if (visited.has(resolved)) return
  visited.add(resolved)

  const stats = statSafe(resolved)
  if (!stats) return

  if (stats.isFile()) {
    bucket.push({
      path: resolved,
      size: stats.size,
      modifiedAt: stats.mtimeMs
    })
    return
  }

  if (!stats.isDirectory()) return

  let entries = []
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    walkAllFiles(path.join(resolved, entry.name), bucket, visited)
  }
}

function delayTick() {
  return new Promise((resolve) => setImmediate(resolve))
}

function withFsTimeout(promise, ms, fallbackValue) {
  let timeoutId
  return Promise.race([
    promise.finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    }),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(fallbackValue), ms)
    })
  ])
}

async function walkAllFilesAsync(entryPath, bucket, options = {}) {
  const maxFiles = Number(options.maxFiles || 20000)
  const maxMs = Number(options.maxMs || 8000)
  const statTimeoutMs = Number(options.statTimeoutMs || 350)
  const readDirTimeoutMs = Number(options.readDirTimeoutMs || Math.max(800, statTimeoutMs))
  const startedAt = Date.now()
  const visited = new Set()
  const stack = [path.resolve(entryPath)]
  let visitedEntries = 0

  while (stack.length > 0) {
    if (Date.now() - startedAt > maxMs) {
      return { truncated: true, timedOut: true, visited: visitedEntries }
    }

    const current = stack.pop()
    const resolved = path.resolve(current)
    if (visited.has(resolved)) continue
    visited.add(resolved)

    const stats = await withFsTimeout(fs.promises.lstat(resolved).catch(() => null), statTimeoutMs, null)
    if (!stats) {
      organizerDebug({ phase: 'scan:stat-missing-or-timeout', path: resolved })
      continue
    }
    if (stats.isSymbolicLink()) {
      organizerDebug({ phase: 'scan:skip-symlink', path: resolved })
      continue
    }

    if (stats.isFile()) {
      organizerDebug({ phase: 'scan:file', path: resolved, size: stats.size })
      bucket.push({
        path: resolved,
        size: stats.size,
        modifiedAt: stats.mtimeMs
      })
      if (bucket.length >= maxFiles) {
        return { truncated: true, timedOut: false, visited: visitedEntries }
      }
    } else if (stats.isDirectory()) {
      organizerDebug({ phase: 'scan:directory', path: resolved })
      const entries = await withFsTimeout(fs.promises.readdir(resolved, { withFileTypes: true }).catch(() => []), readDirTimeoutMs, [])
      organizerDebug({ phase: 'scan:directory-entries', path: resolved, entries: entries.length })
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry.isSymbolicLink()) continue
        stack.push(path.join(resolved, entry.name))
      }
    }

    visitedEntries += 1
    if (visitedEntries % 250 === 0) await delayTick()
  }

  return { truncated: false, timedOut: false, visited: visitedEntries }
}

function extractQuality(text) {
  const value = cleanText(text).toUpperCase()
  if (value.includes('2160') || value.includes('4K')) return '4K'
  if (value.includes('1080')) return '1080p'
  if (value.includes('720')) return '720p'
  if (value.includes('HDRIP')) return 'HDRip'
  if (value.includes('WEB-DL')) return 'WEB-DL'
  return ''
}

function extractLanguage(text) {
  const value = cleanText(text).toUpperCase()
  if (value.includes('VOSE')) return 'VOSE'
  if (value.includes('DUAL')) return 'DUAL'
  if (value.includes('CASTELLANO') || value.includes('ESPANOL') || value.includes('ESPAÑOL') || /\bESP\b/.test(value)) return 'ESP'
  if (value.includes('ENG') || value.includes('ENGLISH')) return 'ENG'
  return ''
}

function extractYear(text) {
  const match = cleanText(text).match(/\b(19|20)\d{2}\b/)
  return match ? match[0] : ''
}

function parseEpisodeToken(text) {
  const value = cleanText(text)
  let match = value.match(/(?:^|[ ._-])[Ss](\d{1,2})[Ee](\d{1,2})(?=[ ._-]|$)/)
  if (match) {
    return {
      season: Number(match[1]),
      episode: Number(match[2]),
      token: match[0]
    }
  }

  match = value.match(/\b(\d{1,2})x(\d{1,2})\b/i)
  if (match) {
    return {
      season: Number(match[1]),
      episode: Number(match[2]),
      token: match[0]
    }
  }

  return null
}

function isSeasonDirectoryName(value) {
  return /^(s|season|temporada)[ ._-]?\d{1,2}$/i.test(cleanText(value))
}

function sanitizeTitleToken(text) {
  return cleanText(text)
    .replace(/[._]+/g, ' ')
    .replace(/\b(2160p|1080p|720p|x264|x265|h264|h265|webrip|web-dl|bluray|bdrip|hdrip|dvdrip|remux|proper|repack|multi|dual|vose|castellano|espanol|español|eng|aac|dts|ac3)\b/gi, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeReleaseText(text) {
  return cleanText(text)
    .replace(/[._-]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]+\)/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripOrganizationNoise(text) {
  const escaped = RELEASE_WORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const releasePattern = new RegExp(`\\b(${escaped})\\b`, 'gi')
  return normalizeReleaseText(text)
    .replace(/\b(?:cap|capitulo|episode|episodio|ep)\s*\d{1,3}\b/gi, ' ')
    .replace(/\b(?:season|temporada)\s*\d{1,2}\b/gi, ' ')
    .replace(releasePattern, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(proper|repack|rerip|internal|extended|complete|limited)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTagText(text) {
  return cleanText(text)
    .replace(/[._-]+/g, ' ')
    .replace(/[\[\](){}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractOrganizationQuality(text) {
  const value = normalizeTagText(text).toUpperCase()
  if (/\b(2160P|4K|UHD)\b/.test(value)) return '4K'
  if (/\b1440P\b/.test(value)) return '1440p'
  if (/\b1080P\b/.test(value)) return '1080p'
  if (/\b720P\b/.test(value)) return '720p'
  if (/\b576P\b/.test(value)) return '576p'
  if (/\b480P\b/.test(value)) return '480p'
  if (/\bHDRIP\b/.test(value)) return 'HDRip'
  if (/\b(WEB DL|WEBDL)\b/.test(value)) return 'WEB-DL'
  if (/\bWEBRIP\b/.test(value)) return 'WEBRip'
  if (/\b(BLURAY|BLU RAY)\b/.test(value)) return 'BluRay'
  if (/\bHDTV\b/.test(value)) return 'HDTV'
  return ''
}

function extractOrganizationLanguage(text) {
  const value = normalizeTagText(text).toUpperCase()
  if (/\bVOSE\b/.test(value)) return 'VOSE'
  if (/\bDUAL\b/.test(value)) return 'DUAL'
  if (/\b(CASTELLANO|ESPANOL|ESPAÑOL|SPANISH|LATINO|ESP)\b/.test(value)) return 'ESP'
  if (/\b(ENG|ENGLISH)\b/.test(value)) return 'ENG'
  return ''
}

function extractOrganizationCodec(text) {
  const value = normalizeTagText(text).toUpperCase()
  if (/\b(HEVC|H ?265|X265)\b/.test(value)) return 'x265'
  if (/\b(AVC|H ?264|X264)\b/.test(value)) return 'x264'
  return ''
}

function extractOrganizationSource(text) {
  const value = normalizeTagText(text).toUpperCase()
  if (/\b(WEB DL|WEBDL)\b/.test(value)) return 'WEB-DL'
  if (/\bWEBRIP\b/.test(value)) return 'WEBRip'
  if (/\b(BLU RAY|BLURAY|BDRIP|BRRIP)\b/.test(value)) return 'BluRay'
  if (/\bHDTV\b/.test(value)) return 'HDTV'
  if (/\bREMUX\b/.test(value)) return 'REMUX'
  return ''
}

function parseOrganizationSeasonFromDirectory(value) {
  const match = cleanText(value).match(/^(?:s|season|temporada)[ ._-]?(\d{1,2})$/i)
  return match ? Number(match[1]) : null
}

function inferOrganizationSeasonFromPath(filePath, rootPath) {
  const root = path.resolve(rootPath)
  let current = path.dirname(path.resolve(filePath))

  while (current && current.toLowerCase() !== root.toLowerCase()) {
    const season = parseOrganizationSeasonFromDirectory(path.basename(current))
    if (season != null) return season
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

function parseOrganizationEpisodeToken(text) {
  const value = cleanText(text)
    .replace(/[._-]+/g, ' ')
    .replace(/[\[\](){}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const patterns = [
    /(?:^|\s)[Ss](\d{1,2})\s*[Ee](\d{1,3})(?=\s|$)/,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /\b[Tt](\d{1,2})\s*[CcEe](\d{1,3})\b/,
    /\b(?:cap|capitulo|episode|episodio|ep)\s*([1-9])(\d{2})\b/i,
    /\b(?:season|temporada)\s*(\d{1,2})\s*(?:episode|episodio|capitulo|ep|e)\s*(\d{1,3})\b/i
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match) {
      return {
        season: Number(match[1]),
        episode: Number(match[2]),
        token: match[0].trim(),
        index: match.index || 0
      }
    }
  }

  const episodeOnly = value.match(/\b(?:episode|episodio|capitulo|ep)\s*(\d{1,3})\b/i)
  if (episodeOnly) {
    return {
      season: null,
      episode: Number(episodeOnly[1]),
      token: episodeOnly[0].trim(),
      index: episodeOnly.index || 0
    }
  }

  return null
}

function buildOrganizationTargetName(parsed, duplicateIndex = 0) {
  const base = `${safeName(parsed.title)} - S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')}`
  const tags = []
  if (parsed.isVideo) {
    if (parsed.quality) tags.push(parsed.quality)
    if (parsed.language) tags.push(parsed.language)
    if (parsed.codec) tags.push(parsed.codec)
  } else if (parsed.ext && !SUBTITLE_EXTENSIONS.has(parsed.ext)) {
    const originalBase = safeName(path.basename(parsed.file.path, parsed.ext))
    const suffix = originalBase && !normalizeCompare(originalBase).includes(normalizeCompare(base)) ? originalBase.slice(0, 32) : ''
    if (suffix) tags.push(suffix)
  }
  if (duplicateIndex > 0) tags.push(`duplicate ${duplicateIndex + 1}`)
  return `${base}${tags.length ? ` [${tags.join(' ')}]` : ''}${parsed.ext}`
}

function scoreSeriesCandidate(name, releaseText) {
  const nameCompact = compactCompare(name)
  const releaseCompact = compactCompare(releaseText)
  if (!nameCompact || !releaseCompact) return 0

  let score = 0
  if (releaseCompact.startsWith(nameCompact)) score += 100
  if (releaseCompact.includes(nameCompact)) score += 70
  if (nameCompact.startsWith(releaseCompact) && releaseCompact.length >= 8) score += 45
  if (score === 0) return 0
  score += Math.min(nameCompact.length, 40)
  score -= Math.max(0, nameCompact.length - 40) * 2
  return score
}

function getKnownSeriesNames(rootPath) {
  try {
    return fs.readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !isSeasonDirectoryName(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function createOrganizationContext(rootPath) {
  return {
    knownSeries: getKnownSeriesNames(rootPath),
    partialCompanionCache: new Map()
  }
}

function isDisposableFile(filePath) {
  const name = path.basename(filePath).toLowerCase()
  const ext = path.extname(filePath).toLowerCase()
  if (DISPOSABLE_NAMES.has(name)) return true
  if (DISPOSABLE_EXTENSIONS.has(ext)) return true
  if (/sample|screens?|cover|poster|fanart/i.test(name) && !VIDEO_EXTENSIONS.has(ext) && !SUBTITLE_EXTENSIONS.has(ext)) return true
  return false
}

function isPartialDownloadFile(filePath) {
  const lower = String(filePath || '').toLowerCase()
  const ext = path.extname(lower)
  return PARTIAL_EXTENSIONS.has(ext) || lower.includes('.!qb') || lower.includes('.!ut') || lower.includes('incomplete')
}

function hasPartialCompanion(filePath, context = null) {
  const directory = path.dirname(filePath)
  const base = path.basename(filePath)
  const cacheKey = directory.toLowerCase()
  try {
    let names = context?.partialCompanionCache?.get(cacheKey)
    if (!names) {
      names = fs.readdirSync(directory)
      context?.partialCompanionCache?.set(cacheKey, names)
    }
    return names.some((name) => {
      const lower = name.toLowerCase()
      return lower.startsWith(base.toLowerCase()) && (
        lower.endsWith('.!qb') ||
        lower.endsWith('.part') ||
        lower.endsWith('.crdownload') ||
        lower.endsWith('.download') ||
        lower.endsWith('.!ut')
      )
    })
  } catch {
    return false
  }
}

function isCompleteVideoFile(filePath, context = null) {
  if (!VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return false
  const stats = statSafe(filePath)
  if (!stats || stats.size <= 0) return false
  if (isPartialDownloadFile(filePath) || hasPartialCompanion(filePath, context)) return false
  return true
}

function inferSeriesTitleFromPath(filePath, rootPath) {
  const root = path.resolve(rootPath)
  let current = path.dirname(path.resolve(filePath))
  const candidates = []

  while (current && current.toLowerCase() !== root.toLowerCase()) {
    const name = path.basename(current)
    if (name && !isSeasonDirectoryName(name)) candidates.unshift(name)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return sanitizeTitleToken(candidates[0] || candidates[candidates.length - 1] || '')
}

function parseSeriesFileForOrganization(file, rootPath, context = null) {
  const ext = path.extname(file.path).toLowerCase()
  const baseName = path.basename(file.path, ext)
  const relativePath = path.relative(rootPath, file.path)
  const parentText = path.dirname(relativePath).split(path.sep).join(' ')
  const evidenceText = `${baseName} ${parentText}`
  const releaseText = normalizeReleaseText(evidenceText)
  const episodeInfo = parseOrganizationEpisodeToken(evidenceText)
  if (!episodeInfo) return null

  const inferredSeason = inferOrganizationSeasonFromPath(file.path, rootPath)
  const season = episodeInfo.season || inferredSeason
  if (!season) return null

  const knownSeries = context?.knownSeries || getKnownSeriesNames(rootPath)
  const knownMatch = knownSeries
    .map((name) => ({ name, score: scoreSeriesCandidate(name, releaseText) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]

  const baseReleaseText = normalizeReleaseText(baseName)
  const baseEpisodeInfo = parseOrganizationEpisodeToken(baseReleaseText)
  const rawTitle = baseEpisodeInfo ? baseReleaseText.slice(0, baseEpisodeInfo.index) : parentText
  const titleFromFile = stripOrganizationNoise(rawTitle)
  const titleFromPath = inferSeriesTitleFromPath(file.path, rootPath)
  const title = safeName(knownMatch?.score >= 45 ? knownMatch.name : titleFromFile || titleFromPath)
  if (!title) return null

  return {
    title,
    season,
    episode: episodeInfo.episode,
    ext,
    quality: extractOrganizationQuality(evidenceText),
    language: extractOrganizationLanguage(evidenceText),
    codec: extractOrganizationCodec(evidenceText),
    source: extractOrganizationSource(evidenceText),
    isVideo: VIDEO_EXTENSIONS.has(ext),
    file
  }
}

function getVersionScore(parsed) {
  const qualityScores = {
    '4K': 600,
    '1440p': 520,
    '1080p': 450,
    '720p': 330,
    '576p': 220,
    '480p': 160,
    BluRay: 420,
    'WEB-DL': 390,
    WEBRip: 330,
    HDTV: 260,
    HDRip: 220
  }
  const languageScores = { DUAL: 70, ESP: 60, VOSE: 45, ENG: 25 }
  const codecScores = { x265: 25, x264: 15 }
  const sourceScores = { REMUX: 45, BluRay: 40, 'WEB-DL': 35, WEBRip: 25, HDTV: 10 }

  return (
    (qualityScores[parsed.quality] || 0) +
    (languageScores[parsed.language] || 0) +
    (codecScores[parsed.codec] || 0) +
    (sourceScores[parsed.source] || 0) +
    Math.min(Math.round(Number(parsed.file.size || 0) / (1024 * 1024 * 1024)), 80)
  )
}

const MAX_ORGANIZATION_PREVIEW_ITEMS = 500

function addOrganizationPreviewItem(report, item) {
  if (item.action !== 'move' && item.action !== 'cleanup' && item.action !== 'warning' && item.action !== 'moved' && item.action !== 'cleaned' && item.action !== 'error' && item.action !== 'missing') {
    return
  }

  if (report.items.length >= MAX_ORGANIZATION_PREVIEW_ITEMS) {
    report.omittedItems = Number(report.omittedItems || 0) + 1
    return
  }

  report.items.push(item)
}

async function buildSeriesOrganizationPlan(rootPath) {
  const startedAt = Date.now()
  const maxPlanMs = 45000
  const cleanRootPath = cleanText(rootPath)
  organizerDebug({ phase: 'plan:requested', rootPath: cleanRootPath })
  if (!cleanRootPath) {
    return { ok: false, error: 'Selecciona una carpeta de series.', moved: 0, skipped: 0, unrecognized: 0, duplicates: 0, items: [] }
  }

  const root = path.resolve(cleanRootPath)
  const rootStats = await withFsTimeout(fs.promises.lstat(root).catch(() => null), 5000, null)
  if (!rootStats?.isDirectory()) {
    return { ok: false, error: 'La carpeta de series no existe.', moved: 0, skipped: 0, unrecognized: 0, duplicates: 0, items: [] }
  }

  const files = []
  organizerDebug('scan:start', root)
  const scanInfo = await walkAllFilesAsync(root, files, { maxMs: 35000, maxFiles: 12000, statTimeoutMs: 1500 })
  organizerDebug('scan:done', { files: files.length, scanInfo, ms: Date.now() - startedAt })
  organizerDebug('context:start')
  const context = createOrganizationContext(root)
  organizerDebug('context:done', { knownSeries: context.knownSeries.length, ms: Date.now() - startedAt })

  const parsedItems = []
  const report = {
    ok: true,
    applied: false,
    root,
    scanned: files.length,
    truncated: scanInfo.truncated,
    timedOut: scanInfo.timedOut,
    moved: 0,
    cleaned: 0,
    skipped: 0,
    unrecognized: 0,
    duplicates: 0,
    warnings: 0,
    omittedItems: 0,
    items: []
  }

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (Date.now() - startedAt > maxPlanMs) {
      report.truncated = true
      report.timedOut = true
      break
    }
    if (index > 0 && index % 250 === 0) await delayTick()

    if (isPartialDownloadFile(file.path)) {
      organizerDebug({ phase: 'parse:skip-partial', path: file.path })
      report.skipped += 1
      continue
    }

    const ext = path.extname(file.path).toLowerCase()
    if (ext === '.txt' || ext === '.url') {
      report.cleaned += 1
      organizerDebug({ phase: 'parse:cleanup-text-url', path: file.path, size: file.size })
      addOrganizationPreviewItem(report, { action: 'cleanup', from: path.resolve(file.path), kind: 'text-url', size: file.size })
      continue
    }

    if (ARCHIVE_EXTENSIONS.has(ext)) {
      report.warnings += 1
      organizerDebug({ phase: 'parse:archive-warning', path: file.path, size: file.size, ext })
      addOrganizationPreviewItem(report, {
        action: 'warning',
        from: path.resolve(file.path),
        kind: 'archive',
        size: file.size,
        warning: 'Archivo comprimido detectado. No se mueve ni se elimina automaticamente.'
      })
      continue
    }

    const parsed = parseSeriesFileForOrganization(file, root, context)
    if (!parsed) {
      if (isDisposableFile(file.path)) {
        if (path.extname(file.path).toLowerCase() === '.torrent') {
          organizerDebug({ phase: 'parse:skip-torrent-without-video', path: file.path })
          report.skipped += 1
          continue
        }
        report.cleaned += 1
        organizerDebug({ phase: 'parse:cleanup-junk', path: file.path, size: file.size })
        addOrganizationPreviewItem(report, { action: 'cleanup', from: file.path, kind: 'junk', size: file.size })
      } else {
        report.unrecognized += 1
        organizerDebug({ phase: 'parse:unrecognized', path: file.path, size: file.size })
      }
      continue
    }

    organizerDebug({
      phase: 'parse:recognized',
      path: file.path,
      title: parsed.title,
      season: parsed.season,
      episode: parsed.episode,
      quality: parsed.quality,
      language: parsed.language,
      codec: parsed.codec,
      isVideo: parsed.isVideo
    })
    parsedItems.push(parsed)
  }
  organizerDebug('parse:done', { parsed: parsedItems.length, report: { cleaned: report.cleaned, skipped: report.skipped, unrecognized: report.unrecognized }, ms: Date.now() - startedAt })

  const readyParsedItems = []
  for (let index = 0; index < parsedItems.length; index += 1) {
    const parsed = parsedItems[index]
    if (Date.now() - startedAt > maxPlanMs) {
      report.truncated = true
      report.timedOut = true
      break
    }
    if (index > 0 && index % 250 === 0) await delayTick()
    if (parsed.isVideo && (Number(parsed.file.size || 0) <= 0 || isPartialDownloadFile(parsed.file.path))) {
      organizerDebug({ phase: 'ready:skip-not-complete', path: parsed.file.path, size: parsed.file.size })
      report.skipped += 1
      continue
    }
    readyParsedItems.push(parsed)
  }
  organizerDebug('ready:done', { ready: readyParsedItems.length, ms: Date.now() - startedAt })

  const videoGroups = new Map()
  for (const parsed of readyParsedItems.filter((entry) => entry.isVideo)) {
    const key = `${normalizeCompare(parsed.title)}:${parsed.season}:${parsed.episode}`
    if (!videoGroups.has(key)) videoGroups.set(key, [])
    videoGroups.get(key).push(parsed)
  }

  const duplicateIndexes = new Map()
  for (const group of videoGroups.values()) {
    if (group.length < 2) continue
    group
      .sort((a, b) => getVersionScore(b) - getVersionScore(a))
      .forEach((entry, index) => duplicateIndexes.set(entry.file.path.toLowerCase(), index))
    report.duplicates += group.length - 1
  }

  const existingVideoKeys = new Set(videoGroups.keys())

  const reservedTargets = new Set()
  for (const parsed of readyParsedItems) {
    const parsedKey = `${normalizeCompare(parsed.title)}:${parsed.season}:${parsed.episode}`
    const shouldClean = isDisposableFile(parsed.file.path) && !parsed.isVideo && !SUBTITLE_EXTENSIONS.has(parsed.ext) && existingVideoKeys.has(parsedKey)
    if (shouldClean) {
      report.cleaned += 1
      addOrganizationPreviewItem(report, {
        action: 'cleanup',
        from: path.resolve(parsed.file.path),
        title: parsed.title,
        season: parsed.season,
        episode: parsed.episode,
        kind: 'junk',
        size: parsed.file.size
      })
      continue
    }

    if (!parsed.isVideo && !SUBTITLE_EXTENSIONS.has(parsed.ext)) {
      report.unrecognized += 1
      organizerDebug({
        phase: 'plan:skip-non-media-auxiliary',
        path: parsed.file.path,
        title: parsed.title,
        season: parsed.season,
        episode: parsed.episode,
        ext: parsed.ext
      })
      continue
    }

    const duplicateIndex = duplicateIndexes.get(parsed.file.path.toLowerCase()) || 0
    const seasonDirectory = path.join(root, safeName(parsed.title), `Temporada ${parsed.season}`)
    let targetPath = path.join(seasonDirectory, buildOrganizationTargetName(parsed, duplicateIndex))
    let collisionIndex = duplicateIndex

    while (
      reservedTargets.has(targetPath.toLowerCase())
    ) {
      collisionIndex += 1
      if (collisionIndex > duplicateIndex + 999) {
        organizerDebug({ phase: 'plan:collision-limit', from: parsed.file.path, targetPath })
        targetPath = path.join(seasonDirectory, `${path.basename(targetPath, parsed.ext)} [${Date.now()}]${parsed.ext}`)
        break
      }
      targetPath = path.join(seasonDirectory, buildOrganizationTargetName(parsed, collisionIndex))
    }

    reservedTargets.add(targetPath.toLowerCase())

    const action = path.resolve(parsed.file.path).toLowerCase() === path.resolve(targetPath).toLowerCase() ? 'skipped' : 'move'
    if (action === 'move') report.moved += 1
    if (action === 'skipped') report.skipped += 1
    organizerDebug({
      phase: `plan:${action}`,
      from: parsed.file.path,
      to: targetPath,
      title: parsed.title,
      season: parsed.season,
      episode: parsed.episode,
      duplicateIndex,
      duplicateRole: duplicateIndexes.has(parsed.file.path.toLowerCase()) ? (duplicateIndex === 0 ? 'best' : 'duplicate') : ''
    })

    addOrganizationPreviewItem(report, {
      action,
      duplicateRole: duplicateIndexes.has(parsed.file.path.toLowerCase()) ? (duplicateIndex === 0 ? 'best' : 'duplicate') : '',
      duplicateIndex,
      from: path.resolve(parsed.file.path),
      to: targetPath,
      title: parsed.title,
      season: parsed.season,
      episode: parsed.episode,
      quality: parsed.quality,
      language: parsed.language,
      codec: parsed.codec,
      source: parsed.source,
      kind: parsed.isVideo ? 'video' : SUBTITLE_EXTENSIONS.has(parsed.ext) ? 'subtitle' : 'auxiliary',
      size: parsed.file.size,
      score: getVersionScore(parsed)
    })
  }

  report.items.sort((a, b) => {
    if (a.action !== b.action) return a.action.localeCompare(b.action)
    return String(a.to || a.from).localeCompare(String(b.to || b.from), 'es')
  })

  organizerDebug('plan:done', { scanned: report.scanned, moved: report.moved, cleaned: report.cleaned, items: report.items.length, ms: Date.now() - startedAt })
  return report
}

function getUniqueTargetPath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath

  const directory = path.dirname(targetPath)
  const ext = path.extname(targetPath)
  const base = path.basename(targetPath, ext)
  let index = 2

  while (index < 1000) {
    const candidate = path.join(directory, `${base} [${index}]${ext}`)
    if (!fs.existsSync(candidate)) return candidate
    index += 1
  }

  return path.join(directory, `${base} [${Date.now()}]${ext}`)
}

function removeEmptyDirectories(directory, stopAt) {
  const stop = path.resolve(stopAt).toLowerCase()
  let current = path.resolve(directory)

  while (current.toLowerCase().startsWith(stop) && current.toLowerCase() !== stop) {
    try {
      const entries = fs.readdirSync(current)
      if (entries.length > 0) return
      fs.rmdirSync(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}

async function disposeFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return true
  try {
    if (shell?.trashItem) {
      await shell.trashItem(filePath)
      return true
    }
  } catch {
    // Fall back to permanent removal when the OS trash is unavailable.
  }

  fs.rmSync(filePath, { force: true })
  return true
}

async function moveFileSafe(sourcePath, targetPath) {
  const finalTargetPath = getUniqueTargetPath(targetPath)
  organizerDebug({ phase: 'move:start', from: sourcePath, to: finalTargetPath })

  try {
    await fs.promises.rename(sourcePath, finalTargetPath)
    organizerDebug({ phase: 'move:rename-ok', from: sourcePath, to: finalTargetPath })
    return finalTargetPath
  } catch (error) {
    organizerDebug({ phase: 'move:rename-failed', from: sourcePath, to: finalTargetPath, code: error.code, message: error.message })
    if (error.code !== 'EXDEV') throw error
  }

  organizerDebug({ phase: 'move:copy-between-devices', from: sourcePath, to: finalTargetPath })
  await fs.promises.copyFile(sourcePath, finalTargetPath, fs.constants.COPYFILE_EXCL)

  const [sourceStats, targetStats] = await Promise.all([
    fs.promises.stat(sourcePath),
    fs.promises.stat(finalTargetPath)
  ])
  if (sourceStats.size !== targetStats.size) {
    await fs.promises.rm(finalTargetPath, { force: true }).catch(() => {})
    organizerDebug({ phase: 'move:copy-size-mismatch', from: sourcePath, to: finalTargetPath, sourceSize: sourceStats.size, targetSize: targetStats.size })
    throw new Error('La copia entre unidades no coincide en tamano; se ha cancelado el movimiento.')
  }

  await fs.promises.rm(sourcePath, { force: true })
  organizerDebug({ phase: 'move:copy-ok-source-removed', from: sourcePath, to: finalTargetPath, size: targetStats.size })
  return finalTargetPath
}

async function organizeSeriesFolder(rootPath) {
  const report = await buildSeriesOrganizationPlan(rootPath)
  if (!report.ok) return report
  report.applied = true

  for (const item of report.items.filter((entry) => entry.action === 'move')) {
    try {
      if (!pathExists(item.from)) {
        organizerDebug({ phase: 'apply:missing', path: item.from })
        item.action = 'missing'
        item.error = 'El archivo ya no existe.'
        continue
      }
      fs.mkdirSync(path.dirname(item.to), { recursive: true })
      item.to = await moveFileSafe(item.from, item.to)
      removeEmptyDirectories(path.dirname(item.from), report.root)
      item.action = 'moved'
      organizerDebug({ phase: 'apply:moved', from: item.from, to: item.to })
    } catch (error) {
      item.action = 'error'
      item.error = error.message
      organizerDebug({ phase: 'apply:move-error', from: item.from, to: item.to, message: error.message, code: error.code })
    }
  }

  for (const item of report.items.filter((entry) => entry.action === 'cleanup')) {
    try {
      if (!pathExists(item.from)) {
        item.action = 'missing'
        item.error = 'El archivo ya no existe.'
        continue
      }
      await disposeFile(item.from)
      removeEmptyDirectories(path.dirname(item.from), report.root)
      item.action = 'cleaned'
      organizerDebug({ phase: 'apply:cleaned', path: item.from })
    } catch (error) {
      item.action = 'error'
      item.error = error.message
      organizerDebug({ phase: 'apply:cleanup-error', path: item.from, message: error.message, code: error.code })
    }
  }

  report.moved = report.items.filter((entry) => entry.action === 'moved').length
  report.cleaned = report.items.filter((entry) => entry.action === 'cleaned').length
  report.skipped = report.items.filter((entry) => entry.action === 'skipped' || entry.action === 'error' || entry.action === 'missing' || entry.action === 'incomplete').length
  return report
}

function parseMediaFile(file, sourceRoot = '') {
  const ext = path.extname(file.path).toLowerCase()
  const baseName = path.basename(file.path, ext)
  const normalizedBase = baseName.replace(/[._]+/g, ' ')
  const relativePath = sourceRoot ? path.relative(sourceRoot, file.path) : file.path
  const parentText = path.dirname(relativePath).split(path.sep).join(' ')
  const year = extractYear(`${normalizedBase} ${parentText}`)
  const quality = extractQuality(normalizedBase)
  const language = extractLanguage(normalizedBase)

  if (BOOK_EXTENSIONS.has(ext)) {
    return {
      itemType: 'book',
      title: sanitizeTitleToken(normalizedBase.replace(year, ' ')) || baseName,
      year,
      quality,
      language,
      season: null,
      episode: null,
      episodeTitle: '',
      file
    }
  }

  if (VIDEO_EXTENSIONS.has(ext) && sourceRoot) {
    const organizedSeries = parseSeriesFileForOrganization(file, sourceRoot)
    if (organizedSeries) {
      return {
        itemType: 'series',
        title: organizedSeries.title,
        year,
        quality: organizedSeries.quality || quality,
        language: organizedSeries.language || language,
        season: organizedSeries.season,
        episode: organizedSeries.episode,
        episodeTitle: '',
        file
      }
    }
  }

  const episodeInfo = parseEpisodeToken(normalizedBase)
  if (episodeInfo) {
    const splitIndex = normalizedBase.toLowerCase().indexOf(String(episodeInfo.token).trim().toLowerCase())
    const rawSeriesTitle = splitIndex > -1 ? normalizedBase.slice(0, splitIndex) : normalizedBase
    const afterToken = splitIndex > -1 ? normalizedBase.slice(splitIndex + String(episodeInfo.token).trim().length) : ''
    const episodeTitle = sanitizeTitleToken(afterToken)

    return {
      itemType: 'series',
      title: sanitizeTitleToken(rawSeriesTitle.replace(year, ' ')) || baseName,
      year,
      quality,
      language,
      season: episodeInfo.season,
      episode: episodeInfo.episode,
      episodeTitle,
      file
    }
  }

  return {
    itemType: 'movie',
    title: sanitizeTitleToken(normalizedBase.replace(year, ' ')) || baseName,
    year,
    quality,
    language,
    season: null,
    episode: null,
    episodeTitle: '',
    file
  }
}

function makeId(type, title, year = '') {
  return crypto.createHash('sha1').update(`${type}:${normalizeCompare(title)}:${year}`).digest('hex').slice(0, 16)
}

function summarizeQuality(values) {
  const ordered = ['4K', '1080p', '720p', 'HDRip', 'WEB-DL']
  for (const candidate of ordered) {
    if (values.includes(candidate)) return candidate
  }
  return values[0] || ''
}

function summarizeLanguage(values) {
  const ordered = ['ESP', 'DUAL', 'VOSE', 'ENG']
  for (const candidate of ordered) {
    if (values.includes(candidate)) return candidate
  }
  return values[0] || ''
}

function createBaseItem(type, title, year) {
  return {
    id: makeId(type, title, year),
    imdbId: '',
    title,
    year,
    type,
    quality: '',
    language: '',
    poster: '',
    url: `library://${type}/${encodeURIComponent(title)}`,
    rating: '',
    provider: 'local',
    synopsis: '',
    genres: [],
    duration: '',
    director: '',
    cast: [],
    seasons: [],
    files: [],
    totalSize: 0,
    addedAt: Date.now(),
    updatedAt: Date.now()
  }
}

function pushFileInfo(item, parsed) {
  item.files.push({
    path: parsed.file.path,
    size: parsed.file.size,
    modifiedAt: parsed.file.modifiedAt,
    quality: parsed.quality,
    language: parsed.language
  })
  item.totalSize += Number(parsed.file.size || 0)
}

function isInsideDirectory(filePath, directory) {
  if (!filePath || !directory) return false
  const relative = path.relative(path.resolve(directory), path.resolve(filePath))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function dedupeSources(sources, preferredRoot = '') {
  const normalizedSources = ensureArray(sources)
    .map((source) => ({ path: path.resolve(source.path) }))
    .filter((source) => statSafe(source.path)?.isDirectory())
    .sort((a, b) => {
      const aPreferred = preferredRoot && path.resolve(a.path).toLowerCase() === path.resolve(preferredRoot).toLowerCase()
      const bPreferred = preferredRoot && path.resolve(b.path).toLowerCase() === path.resolve(preferredRoot).toLowerCase()
      if (aPreferred !== bPreferred) return aPreferred ? -1 : 1
      return a.path.length - b.path.length
    })

  const result = []
  for (const source of normalizedSources) {
    const nested = result.some((existing) => {
      const relative = path.relative(existing.path, source.path)
      return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    })
    if (!nested) result.push(source)
  }

  return result
}

function scoreParsedFile(parsed, preferredRoot = '') {
  let score = 0
  if (statSafe(parsed.file.path)) score += 100000
  if (preferredRoot && isInsideDirectory(parsed.file.path, preferredRoot)) score += 50000
  if (parsed.quality === '4K') score += 600
  if (parsed.quality === '1080p') score += 450
  if (parsed.quality === '720p') score += 300
  if (parsed.language === 'DUAL') score += 80
  if (parsed.language === 'ESP') score += 70
  if (parsed.language === 'VOSE') score += 50
  score += Math.min(Math.round(Number(parsed.file.size || 0) / (1024 * 1024 * 1024)), 100)
  return score
}

function makeEpisodeEntry(parsed) {
  return {
    number: parsed.episode,
    title: parsed.episodeTitle || `Episodio ${parsed.episode}`,
    quality: parsed.quality,
    language: parsed.language,
    filePath: parsed.file.path,
    size: parsed.file.size,
    modifiedAt: parsed.file.modifiedAt
  }
}

function scoreEpisodeEntry(episode, preferredRoot = '') {
  return scoreParsedFile({
    quality: episode.quality,
    language: episode.language,
    file: {
      path: episode.filePath,
      size: episode.size,
      modifiedAt: episode.modifiedAt
    }
  }, preferredRoot)
}

function looksLikeEpisodeMovieItem(item, sources = []) {
  if (item?.type !== 'movie') return false
  const filePath = item.files?.[0]?.path || ''
  if (!filePath || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return false

  return ensureArray(sources).some((source) => {
    if (!source?.path || !isInsideDirectory(filePath, source.path)) return false
    const file = item.files[0]
    return Boolean(parseSeriesFileForOrganization({
      path: filePath,
      size: file.size,
      modifiedAt: file.modifiedAt
    }, source.path))
  })
}

function normalizeLibraryItems(items, preferredRoot = '', sources = []) {
  return ensureArray(items).filter((item) => !looksLikeEpisodeMovieItem(item, sources)).map((item) => {
    if (item?.type !== 'series' || !Array.isArray(item.seasons)) return item

    return {
      ...item,
      seasons: item.seasons.map((season) => {
        const byEpisode = new Map()
        for (const episode of ensureArray(season.episodes)) {
          const key = Number(episode.number)
          if (!byEpisode.has(key) || scoreEpisodeEntry(episode, preferredRoot) > scoreEpisodeEntry(byEpisode.get(key), preferredRoot)) {
            byEpisode.set(key, episode)
          }
        }

        return {
          ...season,
          episodes: [...byEpisode.values()].sort((a, b) => a.number - b.number)
        }
      }).sort((a, b) => a.number - b.number)
    }
  }).map((item) => {
    if (item?.type !== 'series' || !Array.isArray(item.seasons)) return item
    const files = item.seasons
      .flatMap((season) => season.episodes || [])
      .filter((episode) => episode.filePath)
      .map((episode) => ({
        path: episode.filePath,
        size: episode.size,
        modifiedAt: episode.modifiedAt,
        quality: episode.quality,
        language: episode.language
      }))

    return {
      ...item,
      files,
      totalSize: files.reduce((sum, file) => sum + Number(file.size || 0), 0)
    }
  })
}

function groupParsedFiles(parsedFiles, preferredRoot = '') {
  const groups = new Map()

  for (const parsed of parsedFiles) {
    const key = `${parsed.itemType}:${normalizeCompare(parsed.title)}:${parsed.year}`
    if (!groups.has(key)) {
      groups.set(key, createBaseItem(parsed.itemType, parsed.title, parsed.year))
    }

    const item = groups.get(key)
    pushFileInfo(item, parsed)

    if (parsed.itemType === 'series') {
      let season = item.seasons.find((entry) => entry.number === parsed.season)
      if (!season) {
        season = { number: parsed.season, episodes: [] }
        item.seasons.push(season)
      }

      const nextEpisode = makeEpisodeEntry(parsed)
      const existingIndex = season.episodes.findIndex((episode) => episode.number === parsed.episode)
      if (existingIndex === -1) {
        season.episodes.push(nextEpisode)
      } else {
        const existing = season.episodes[existingIndex]
        const existingParsed = {
          ...parsed,
          quality: existing.quality,
          language: existing.language,
          file: {
            path: existing.filePath,
            size: existing.size,
            modifiedAt: existing.modifiedAt
          }
        }
        if (scoreParsedFile(parsed, preferredRoot) > scoreParsedFile(existingParsed, preferredRoot)) {
          season.episodes[existingIndex] = nextEpisode
        }
      }
    }
  }

  return [...groups.values()].map((item) => {
    const qualities = [...new Set(item.files.map((entry) => entry.quality).filter(Boolean))]
    const languages = [...new Set(item.files.map((entry) => entry.language).filter(Boolean))]
    item.quality = summarizeQuality(qualities)
    item.language = summarizeLanguage(languages)
    item.files.sort((a, b) => a.path.localeCompare(b.path))
    item.seasons.sort((a, b) => a.number - b.number)
    item.seasons.forEach((season) => season.episodes.sort((a, b) => a.number - b.number))
    return item
  })
}

async function enrichItems(items) {
  const enriched = []
  const overrides = await getMetadataOverrides()
  for (const item of items) {
    const metadata = await enrichMetadata(item)
    enriched.push(applyMetadataOverride({
      ...item,
      imdbId: metadata.imdbId || item.imdbId || '',
      poster: metadata.poster || item.poster,
      synopsis: metadata.synopsis || item.synopsis,
      genres: metadata.genres || item.genres,
      duration: metadata.duration || item.duration,
      director: metadata.director || item.director,
      cast: metadata.cast || item.cast,
      rating: metadata.rating || item.rating
    }, overrides))
  }
  return enriched
}

async function rebuildLibraryFromSources(sources) {
  const store = await getStore()
  const preferredRoot = store.get('qbittorrent.seriesDownloadPath', '')
  const activeSources = dedupeSources(sources, preferredRoot)
  const files = []
  const sourceRoots = []
  for (const source of activeSources) {
    walkMediaFiles(source.path, files)
    sourceRoots.push(path.resolve(source.path))
  }

  const dedupedFiles = [...new Map(files.map((file) => [file.path.toLowerCase(), file])).values()]
  const parsedFiles = dedupedFiles.map((file) => {
    const sourceRoot = sourceRoots
      .filter((root) => isInsideDirectory(file.path, root) || path.resolve(file.path).toLowerCase() === root.toLowerCase())
      .sort((a, b) => b.length - a.length)[0] || ''
    return parseMediaFile(file, sourceRoot)
  })
  const grouped = groupParsedFiles(parsedFiles, preferredRoot)
  const enriched = await enrichItems(grouped)

  const state = {
    items: enriched.sort((a, b) => a.title.localeCompare(b.title, 'es')),
    sources: activeSources,
    updatedAt: Date.now()
  }
  await saveLibraryState(state)
  return state
}

async function getItems() {
  const state = await getLibraryState()
  const store = await getStore()
  const overrides = await getMetadataOverrides()
  return normalizeLibraryItems(state.items, store.get('qbittorrent.seriesDownloadPath', ''), state.sources)
    .map((item) => applyMetadataOverride(item, overrides))
}

async function listLibrary() {
  return getItems()
}

async function getLibrarySources() {
  const state = await getLibraryState()
  return ensureArray(state.sources)
}

async function getLibraryItem(id) {
  const items = await getItems()
  return items.find((item) => item.id === id) || null
}

async function updateMetadataOverride(id, data = {}) {
  const items = await getItems()
  const item = items.find((entry) => entry.id === id)
  if (!item) return { ok: false, error: 'No se encontro este contenido.' }

  const overrides = await getMetadataOverrides()
  overrides[id] = {
    ...(overrides[id] || {}),
    ...sanitizeMetadataOverride(data)
  }
  await saveMetadataOverrides(overrides)
  return { ok: true, item: await getLibraryItem(id) }
}

async function clearMetadataOverride(id) {
  const overrides = await getMetadataOverrides()
  delete overrides[id]
  await saveMetadataOverrides(overrides)
  return { ok: true, item: await getLibraryItem(id) }
}

async function searchLibraryMetadataOptions(id) {
  const item = await getLibraryItem(id)
  if (!item) return { ok: false, error: 'No se encontro este contenido.', options: [] }
  const options = await searchMetadataOptions(item)
  return { ok: true, options }
}

async function importPaths(pathsToImport) {
  const currentState = await getLibraryState()
  const normalized = ensureArray(pathsToImport)
    .map((value) => cleanText(value))
    .filter(Boolean)
    .map((value) => ({ path: path.resolve(value) }))

  const deduped = new Map()
  for (const source of [...ensureArray(currentState.sources), ...normalized]) {
    deduped.set(source.path.toLowerCase(), source)
  }

  return rebuildLibraryFromSources([...deduped.values()])
}

async function removeLibraryItem(id) {
  const state = await getLibraryState()
  const nextItems = ensureArray(state.items).filter((item) => item.id !== id)
  const nextState = {
    ...state,
    items: nextItems,
    updatedAt: Date.now()
  }
  await saveLibraryState(nextState)
  return nextState
}

async function clearLibrary() {
  const state = {
    items: [],
    sources: [],
    updatedAt: Date.now()
  }
  await saveLibraryState(state)
  return state
}

async function removeLibrarySource(targetPath) {
  const state = await getLibraryState()
  const nextSources = ensureArray(state.sources).filter((source) => source.path !== targetPath)
  return rebuildLibraryFromSources(nextSources)
}

async function rescanLibrary() {
  const state = await getLibraryState()
  return rebuildLibraryFromSources(ensureArray(state.sources))
}

async function getLibraryStats() {
  const items = await getItems()
  const stats = {
    total: items.length,
    movies: 0,
    series: 0,
    books: 0,
    episodes: 0,
    totalSize: 0
  }

  for (const item of items) {
    if (item.type === 'movie') stats.movies += 1
    if (item.type === 'series') stats.series += 1
    if (item.type === 'book') stats.books += 1
    stats.totalSize += Number(item.totalSize || 0)
    if (Array.isArray(item.seasons)) {
      for (const season of item.seasons) {
        stats.episodes += Array.isArray(season.episodes) ? season.episodes.length : 0
      }
    }
  }

  return stats
}

module.exports = {
  listLibrary,
  getLibraryItem,
  getLibrarySources,
  importPaths,
  removeLibraryItem,
  clearLibrary,
  removeLibrarySource,
  rescanLibrary,
  getLibraryStats,
  updateMetadataOverride,
  clearMetadataOverride,
  searchLibraryMetadataOptions,
  previewOrganizeSeriesFolder: buildSeriesOrganizationPlan,
  organizeSeriesFolder
}
