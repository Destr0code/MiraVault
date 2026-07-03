const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getStore } = require('./storeHelper')

const STORE_KEY = 'torrentProviders'
const TIMEOUT_MS = 12000
const SUPPORTED_TYPES = new Set(['rss', 'torznab', 'json', 'folder'])

function cleanText(value) {
  return String(value || '').trim()
}

function makeId(value = '') {
  return crypto.createHash('sha1').update(String(value || `${Date.now()}-${Math.random()}`)).digest('hex').slice(0, 12)
}

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripTags(value = '') {
  return decodeXml(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function readTag(block, tagName) {
  const match = String(block || '').match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return match ? decodeXml(match[1]).trim() : ''
}

function readAttr(block, tagName, attrName) {
  const tag = String(block || '').match(new RegExp(`<${tagName}\\s+([^>]*)>`, 'i'))?.[1] || ''
  const match = tag.match(new RegExp(`${attrName}=["']([^"']+)["']`, 'i'))
  return match ? decodeXml(match[1]).trim() : ''
}

function inferQuality(title = '') {
  const value = String(title).toLowerCase()
  if (value.includes('2160') || value.includes('4k') || value.includes('uhd')) return '4K'
  if (value.includes('1080')) return '1080p'
  if (value.includes('720')) return '720p'
  if (value.includes('hdrip')) return 'HDRip'
  return ''
}

function inferLanguage(title = '') {
  const value = String(title).toLowerCase()
  if (/\b(vose|sub(?:s|titulado)?)\b/.test(value)) return 'VOSE'
  if (/\b(dual|multi)\b/.test(value)) return 'DUAL'
  if (/\b(eng|english|ingles)\b/.test(value)) return 'ENG'
  if (/\b(esp|spanish|castellano|latino|espanol)\b/.test(value)) return 'ESP'
  return ''
}

function inferSeasonEpisode(title = '') {
  const value = String(title)
  const modern = value.match(/\bS(\d{1,2})E(\d{1,3})\b/i)
  if (modern) return { season: Number(modern[1]), episode: Number(modern[2]) }
  const compact = value.match(/\b(\d{1,2})x(\d{1,3})\b/i)
  if (compact) return { season: Number(compact[1]), episode: Number(compact[2]) }
  return { season: null, episode: null }
}

function inferType(title = '') {
  const episode = inferSeasonEpisode(title)
  if (episode.season && episode.episode) return 'series'
  return 'unknown'
}

function normalizeResult(provider, raw = {}) {
  const title = cleanText(raw.title || raw.name)
  if (!title) return null
  const downloadUrl = cleanText(raw.magnetUrl || raw.magnet || raw.torrentUrl || raw.link || raw.url)
  const { season, episode } = inferSeasonEpisode(title)
  return {
    id: cleanText(raw.id) || makeId(`${provider.id}:${title}:${downloadUrl}`),
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.type,
    title,
    type: cleanText(raw.type) || inferType(title),
    size: Number(raw.size || raw.length || 0),
    seeders: Number(raw.seeders || raw.seeds || 0),
    leechers: Number(raw.leechers || raw.peers || 0),
    publishDate: cleanText(raw.publishDate || raw.pubDate || raw.date),
    magnetUrl: cleanText(raw.magnetUrl || raw.magnet),
    torrentUrl: cleanText(raw.torrentUrl || raw.enclosure || raw.link || raw.url),
    downloadUrl,
    infoHash: cleanText(raw.infoHash || raw.hash),
    quality: cleanText(raw.quality) || inferQuality(title),
    language: cleanText(raw.language) || inferLanguage(title),
    season,
    episode,
    isUserConfigured: true
  }
}

function sanitizeProvider(input = {}) {
  const type = SUPPORTED_TYPES.has(input.type) ? input.type : 'rss'
  return {
    id: cleanText(input.id) || makeId(`${input.name}:${input.url}:${type}`),
    name: cleanText(input.name) || 'Fuente personalizada',
    type,
    url: cleanText(input.url),
    apiKey: cleanText(input.apiKey),
    enabled: input.enabled !== false,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function publicProvider(provider = {}) {
  return { ...provider, apiKey: provider.apiKey ? '********' : '' }
}

async function getProviders({ includeSecrets = false } = {}) {
  const store = await getStore()
  const providers = Array.isArray(store.get(STORE_KEY)) ? store.get(STORE_KEY) : []
  return includeSecrets ? providers : providers.map(publicProvider)
}

async function setProviders(providers = []) {
  const next = Array.isArray(providers) ? providers.map(sanitizeProvider) : []
  const store = await getStore()
  store.set(STORE_KEY, next)
  return next.map(publicProvider)
}

async function saveProvider(provider = {}) {
  const providers = await getProviders({ includeSecrets: true })
  const nextProvider = sanitizeProvider(provider)
  const index = providers.findIndex((item) => item.id === nextProvider.id)
  if (index >= 0) providers[index] = { ...providers[index], ...nextProvider }
  else providers.push(nextProvider)
  return setProviders(providers)
}

async function deleteProvider(providerId) {
  const id = cleanText(providerId)
  const providers = await getProviders({ includeSecrets: true })
  return setProviders(providers.filter((provider) => provider.id !== id))
}

async function fetchText(url, headers = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MiraVault/1.0 user-configured-torrent-source',
        Accept: 'application/rss+xml, application/xml, application/json, text/xml, text/plain, */*',
        ...headers
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  } finally {
    clearTimeout(timeout)
  }
}

function buildProviderUrl(provider, query = '') {
  if (provider.type === 'folder') return provider.url
  const base = provider.url
  if (!base) return ''
  if (provider.type === 'torznab') {
    const url = new URL(base)
    url.searchParams.set('t', 'search')
    if (query) url.searchParams.set('q', query)
    if (provider.apiKey) url.searchParams.set('apikey', provider.apiKey)
    return url.toString()
  }
  if (!query) return base
  if (base.includes('{query}')) return base.replaceAll('{query}', encodeURIComponent(query))
  return base
}

function parseRss(provider, text) {
  const blocks = String(text || '').match(/<item[\s\S]*?<\/item>/gi) || []
  return blocks.map((block) => {
    const title = stripTags(readTag(block, 'title'))
    const link = stripTags(readTag(block, 'link'))
    const enclosure = readAttr(block, 'enclosure', 'url')
    const magnet = block.match(/magnet:\?xt=urn:[^<\s"']+/i)?.[0] || ''
    const size = readAttr(block, 'enclosure', 'length')
    const seeders = readTag(block, 'torznab:attr').includes('seeders') ? readAttr(block, 'torznab:attr', 'value') : ''
    return normalizeResult(provider, {
      title,
      link,
      torrentUrl: enclosure || link,
      magnetUrl: magnet,
      size,
      seeders,
      publishDate: stripTags(readTag(block, 'pubDate'))
    })
  }).filter(Boolean)
}

function parseJson(provider, text) {
  const data = JSON.parse(text)
  const items = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : Array.isArray(data.items) ? data.items : []
  return items.map((item) => normalizeResult(provider, item)).filter(Boolean)
}

async function searchFolder(provider, query = '') {
  const root = provider.url
  if (!root || !fs.existsSync(root)) return []
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
  const normalizedQuery = query.toLowerCase()
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(root, entry.name))
    .filter((filePath) => {
      const lower = filePath.toLowerCase()
      const supported = lower.endsWith('.torrent') || lower.endsWith('.magnet') || lower.endsWith('.txt')
      return supported && (!normalizedQuery || path.basename(lower).includes(normalizedQuery))
    })
    .slice(0, 100)

  const results = []
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase()
    let magnetUrl = ''
    if (ext === '.magnet' || ext === '.txt') {
      const text = await fs.promises.readFile(filePath, 'utf8').catch(() => '')
      magnetUrl = text.match(/magnet:\?xt=urn:[^\s]+/i)?.[0] || ''
      if (!magnetUrl && ext === '.txt') continue
    }
    results.push(normalizeResult(provider, {
      title: path.basename(filePath, ext),
      torrentUrl: ext === '.torrent' ? filePath : '',
      magnetUrl
    }))
  }
  return results.filter(Boolean)
}

async function searchProvider(provider, query = '') {
  if (!provider.enabled) return []
  if (provider.type === 'folder') return searchFolder(provider, query)
  const url = buildProviderUrl(provider, query)
  if (!url) return []
  const text = await fetchText(url)
  if (provider.type === 'json') return parseJson(provider, text)
  return parseRss(provider, text)
}

async function search(query = '', providerId = '') {
  const providers = await getProviders({ includeSecrets: true })
  const active = providers.filter((provider) => provider.enabled && (!providerId || provider.id === providerId))
  const batches = await Promise.allSettled(active.map((provider) => searchProvider(provider, cleanText(query))))
  return batches.flatMap((batch) => batch.status === 'fulfilled' ? batch.value : []).slice(0, 200)
}

async function testProvider(providerId) {
  const providers = await getProviders({ includeSecrets: true })
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return { ok: false, error: 'Proveedor no encontrado.' }
  try {
    const results = await searchProvider(provider, '')
    return { ok: true, count: results.length }
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'Tiempo de espera agotado.' : error.message }
  }
}

module.exports = {
  deleteProvider,
  getProviders,
  saveProvider,
  search,
  setProviders,
  testProvider
}
