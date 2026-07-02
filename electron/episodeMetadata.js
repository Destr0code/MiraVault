const { getStore } = require('./storeHelper')

const TVMAZE_BASE_URL = 'https://api.tvmaze.com'
const REQUEST_TIMEOUT = 9000
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30

function cleanText(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeImdbId(value) {
  const match = cleanText(value).match(/\btt\d{5,12}\b/i)
  return match ? match[0].toLowerCase() : ''
}

async function fetchJson(url, params = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  const query = new URLSearchParams(params)
  const target = `${url}${query.toString() ? `?${query.toString()}` : ''}`

  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MiraVault/1.0 episode metadata',
        Accept: 'application/json,text/plain,*/*'
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function cacheKey(payload = {}) {
  return [
    'episode-metadata-v1',
    normalizeImdbId(payload.imdbId) || normalizeCompare(payload.seriesTitle),
    Number(payload.season) || 0,
    Number(payload.episode) || 0
  ].join(':')
}

async function getCachedEpisode(key) {
  try {
    const store = await getStore()
    const cache = store.get('episodeMetadataCache', {})
    const entry = cache[key]
    if (!entry || Date.now() - Number(entry.updatedAt || 0) > CACHE_TTL) return null
    return entry.data || null
  } catch {
    return null
  }
}

async function setCachedEpisode(key, data) {
  try {
    const store = await getStore()
    const cache = store.get('episodeMetadataCache', {})
    cache[key] = { updatedAt: Date.now(), data }
    const keys = Object.keys(cache)
    if (keys.length > 1000) {
      keys
        .sort((a, b) => Number(cache[a]?.updatedAt || 0) - Number(cache[b]?.updatedAt || 0))
        .slice(0, keys.length - 1000)
        .forEach((oldKey) => delete cache[oldKey])
    }
    store.set('episodeMetadataCache', cache)
  } catch {
    // Cache is only an optimization.
  }
}

function scoreShow(show, seriesTitle) {
  const wanted = normalizeCompare(seriesTitle)
  const candidate = normalizeCompare(show?.name)
  if (!wanted || !candidate) return 0
  if (candidate === wanted) return 100
  if (candidate.includes(wanted) || wanted.includes(candidate)) return 78
  return 0
}

async function findShow(payload = {}) {
  const imdbId = normalizeImdbId(payload.imdbId)
  if (imdbId) {
    const show = await fetchJson(`${TVMAZE_BASE_URL}/lookup/shows`, { imdb: imdbId }).catch(() => null)
    if (show?.id) return show
  }

  const title = cleanText(payload.seriesTitle)
  if (!title) return null
  const results = await fetchJson(`${TVMAZE_BASE_URL}/search/shows`, { q: title }).catch(() => [])
  const scored = (Array.isArray(results) ? results : [])
    .map((entry) => ({ show: entry.show, score: scoreShow(entry.show, title) + Number(entry.score || 0) * 20 }))
    .filter((entry) => entry.show?.id && entry.score >= 45)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.show || null
}

async function getEpisodeMetadata(payload = {}) {
  const season = Number(payload.season) || 0
  const episode = Number(payload.episode) || 0
  if (!season || !episode) return { ok: false, error: 'Falta temporada o episodio.' }

  const key = cacheKey(payload)
  const cached = await getCachedEpisode(key)
  if (cached) return { ok: true, metadata: cached, cached: true }

  try {
    const show = await findShow(payload)
    if (!show?.id) return { ok: true, metadata: null }

    const data = await fetchJson(`${TVMAZE_BASE_URL}/shows/${show.id}/episodebynumber`, { season, number: episode })
    if (!data?.id) return { ok: true, metadata: null }

    const metadata = {
      provider: 'tvmaze',
      showId: show.id,
      id: data.id,
      title: cleanText(data.name || ''),
      season: Number(data.season) || season,
      episode: Number(data.number) || episode,
      synopsis: cleanText(data.summary || ''),
      rating: data.rating?.average ? String(data.rating.average) : '',
      airDate: cleanText(data.airdate || ''),
      runtime: data.runtime ? `${data.runtime} min` : '',
      image: cleanText(data.image?.original || data.image?.medium || ''),
      url: cleanText(data.url || '')
    }

    await setCachedEpisode(key, metadata)
    return { ok: true, metadata, cached: false }
  } catch (error) {
    return { ok: false, error: error.message || 'No se pudo cargar metadata del episodio.' }
  }
}

module.exports = {
  getEpisodeMetadata
}
