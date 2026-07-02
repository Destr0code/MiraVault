const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const STREMIO_SUBTITLES_BASE_URL = 'https://opensubtitles-v3.strem.io'
const REQUEST_TIMEOUT = 12000
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa'])
const PREFERRED_LANGS = ['spa', 'es', 'eng', 'en']

function cleanText(value) {
  return String(value || '').trim()
}

function normalizeImdbId(value) {
  const match = cleanText(value).match(/\btt\d{5,12}\b/i)
  return match ? match[0].toLowerCase() : ''
}

function safeName(value) {
  return cleanText(value).replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, ' ').slice(0, 120) || 'subtitle'
}

function subtitleCacheDir() {
  const dir = path.join(app.getPath('userData'), 'subtitles')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function scoreLocalSubtitle(filePath, videoBaseName) {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase()
  let score = 0
  if (name === videoBaseName.toLowerCase()) score += 100
  if (/\b(spa|es|spanish|castellano|espanol|español)\b/i.test(name)) score += 40
  if (/\b(eng|en|english)\b/i.test(name)) score += 15
  return score
}

function findLocalSubtitles(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return []
    const dir = path.dirname(filePath)
    const videoBase = path.basename(filePath, path.extname(filePath))
    return fs.readdirSync(dir)
      .filter((name) => SUBTITLE_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => path.join(dir, name))
      .map((subtitlePath) => ({
        id: `local:${subtitlePath}`,
        source: 'local',
        lang: detectLanguageFromName(subtitlePath),
        path: subtitlePath,
        label: path.basename(subtitlePath),
        fileName: path.basename(subtitlePath),
        score: scoreLocalSubtitle(subtitlePath, videoBase)
      }))
      .sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

function detectLanguageFromName(filePath) {
  const name = path.basename(filePath).toLowerCase()
  if (/\b(spa|es|spanish|castellano|espanol|español)\b/i.test(name)) return 'spa'
  if (/\b(eng|en|english)\b/i.test(name)) return 'eng'
  return ''
}

function stremioIdFor(payload = {}) {
  const imdbId = normalizeImdbId(payload.imdbId)
  if (!imdbId) return ''

  if (payload.type === 'series' && Number(payload.season) > 0 && Number(payload.episode) > 0) {
    return `${imdbId}:${Number(payload.season)}:${Number(payload.episode)}`
  }

  return imdbId
}

function stremioTypeFor(payload = {}) {
  return payload.type === 'series' ? 'series' : 'movie'
}

function scoreRemoteSubtitle(entry) {
  const lang = cleanText(entry.lang).toLowerCase()
  const preferredIndex = PREFERRED_LANGS.indexOf(lang)
  let score = preferredIndex === -1 ? 0 : 100 - preferredIndex * 10
  score += Math.min(Number(entry.g || 0), 30)
  return score
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MiraVault/1.0 subtitles',
        Accept: 'application/json,text/plain,*/*'
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchText(url, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MiraVault/1.0 subtitles',
        Accept: 'text/plain,*/*'
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function findStremioSubtitles(payload = {}) {
  const id = stremioIdFor(payload)
  if (!id) return []

  const url = `${STREMIO_SUBTITLES_BASE_URL}/subtitles/${stremioTypeFor(payload)}/${encodeURIComponent(id)}.json`
  try {
    const data = await fetchJson(url)
    return (Array.isArray(data?.subtitles) ? data.subtitles : [])
      .filter((entry) => entry?.url)
      .map((entry) => ({
        id: `stremio:${entry.id || entry.url}`,
        remoteId: cleanText(entry.id || ''),
        source: 'opensubtitles-stremio',
        lang: cleanText(entry.lang),
        encoding: cleanText(entry.SubEncoding),
        url: entry.url,
        label: `${cleanText(entry.lang).toUpperCase() || 'SUB'} - OpenSubtitles${entry.id ? ` #${entry.id}` : ''}`,
        score: scoreRemoteSubtitle(entry)
      }))
      .sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

async function listSubtitles(payload = {}) {
  const local = findLocalSubtitles(payload.filePath)
  const remote = await findStremioSubtitles(payload)
  return [...local, ...remote]
}

async function downloadRemoteSubtitle(subtitle, payload = {}) {
  if (!subtitle?.url) return null
  const text = await fetchText(subtitle.url)
  if (!text || text.length < 5) return null

  const idPart = safeName(subtitle.id || subtitle.url)
  const titlePart = safeName(payload.title || payload.progressKey || 'subtitle')
  const langPart = safeName(subtitle.lang || 'sub')
  const filePath = path.join(subtitleCacheDir(), `${titlePart}-${langPart}-${idPart}.srt`)
  fs.writeFileSync(filePath, text, 'utf8')
  return filePath
}

async function resolveSubtitle(payload = {}) {
  const subtitles = await listSubtitles(payload)
  const subtitleId = cleanText(payload.subtitleId || 'auto')
  if (subtitleId === 'none') return { ok: true, subtitle: null, subtitles }

  const selected = subtitleId === 'auto'
    ? subtitles[0] || null
    : subtitles.find((subtitle) => subtitle.id === subtitleId) || null

  if (!selected) return { ok: true, subtitle: null, subtitles }

  if (selected.source === 'local') {
    return { ok: true, subtitle: selected, subtitles }
  }

  try {
    const filePath = await downloadRemoteSubtitle(selected, payload)
    if (!filePath) return { ok: true, subtitle: null, subtitles }
    return {
      ok: true,
      subtitle: {
        ...selected,
        path: filePath
      },
      subtitles
    }
  } catch (error) {
    return { ok: false, error: error.message, subtitle: null, subtitles }
  }
}

module.exports = {
  listSubtitles,
  resolveSubtitle
}
