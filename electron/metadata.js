const axios = require('axios').default
const { getStore } = require('./storeHelper')

const CINEMETA_BASE_URL = 'https://v3-cinemeta.strem.io'
const TVMAZE_BASE_URL = 'https://api.tvmaze.com'
const OPEN_LIBRARY_URL = 'https://openlibrary.org/search.json'
const GUTENDEX_URL = 'https://gutendex.com/books'
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search'
const JIKAN_ANIME_URL = 'https://api.jikan.moe/v4/anime'
const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co'
const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php'
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql'
const WIKIPEDIA_SUMMARY_BASE = 'https://es.wikipedia.org/api/rest_v1/page/summary'
const COMMONS_FILE_BASE = 'https://commons.wikimedia.org/wiki/Special:FilePath'
const REQUEST_TIMEOUT = 9000
const CACHE_TTL = 1000 * 60 * 60 * 24 * 45
const CACHE_VERSION = 'v3'
const EMPTY_METADATA = {
  imdbId: '',
  poster: '',
  synopsis: '',
  genres: [],
  duration: '',
  director: '',
  cast: [],
  rating: '',
  provider: ''
}

const DEFAULT_HEADERS = {
  'User-Agent': 'MiraVault/1.0 (open-source media library; no api key)',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
}

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

function normalizeLooseTitle(value) {
  return normalizeCompare(value)
    .replace(/\b(the|a|an|el|la|los|las|un|una|unos|unas)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function metadataCacheKey(base) {
  return `${CACHE_VERSION}:${base.type || 'movie'}:${normalizeCompare(base.title)}:${cleanText(base.year)}`
}

function mergeMetadata(...entries) {
  const result = { ...EMPTY_METADATA }
  for (const entry of entries) {
    if (!entry) continue
    for (const key of ['imdbId', 'poster', 'synopsis', 'duration', 'director', 'rating', 'provider']) {
      if (!result[key] && entry[key]) result[key] = entry[key]
    }
    if (result.genres.length === 0 && Array.isArray(entry.genres) && entry.genres.length) result.genres = entry.genres
    if (result.cast.length === 0 && Array.isArray(entry.cast) && entry.cast.length) result.cast = entry.cast
  }
  return result
}

function normalizeImdbId(value) {
  const match = cleanText(value).match(/\btt\d{5,12}\b/i)
  return match ? match[0].toLowerCase() : ''
}

function optionFromMetadata(source, provider, score = 0) {
  if (!source) return null
  const poster = cleanText(
    source.poster ||
    source.coverImage?.extraLarge ||
    source.coverImage?.large ||
    source.images?.jpg?.large_image_url ||
    source.images?.webp?.large_image_url ||
    source.image?.original ||
    source.image?.medium ||
    source.artworkUrl100 ||
    ''
  ).replace('100x100bb', '600x600bb')
  return {
    provider,
    score,
    imdbId: normalizeImdbId(source.imdbId || source.imdb_id || source.imdb || source.id),
    title: cleanText(source.title || source.name || source.trackName || source.collectionName || source.title_english || source.title_japanese || ''),
    year: candidateYear(source),
    poster,
    synopsis: cleanText(source.description || source.overview || source.summary || source.longDescription || source.shortDescription || source.synopsis || ''),
    genres: Array.isArray(source.genre) ? source.genre.map(cleanText).filter(Boolean) : Array.isArray(source.genres) ? source.genres.map(cleanText).filter(Boolean) : source.primaryGenreName ? [cleanText(source.primaryGenreName)] : [],
    duration: cleanText(source.runtime || source.duration || (source.averageRuntime ? `${source.averageRuntime} min` : '') || (source.trackTimeMillis ? `${Math.round(Number(source.trackTimeMillis) / 60000)} min` : '')),
    director: Array.isArray(source.director) ? source.director.map(cleanText).filter(Boolean).join(', ') : cleanText(source.director || ''),
    cast: Array.isArray(source.cast) ? source.cast.slice(0, 12).map(cleanText).filter(Boolean) : [],
    rating: ratingFromMeta(source)
  }
}

function hasUsefulMetadata(entry) {
  return Boolean(entry?.poster || entry?.synopsis || entry?.rating || entry?.genres?.length || entry?.cast?.length)
}

function ratingFromMeta(meta) {
  if (meta?.averageScore) return String(Math.round(Number(meta.averageScore)) / 10)
  return cleanText(meta?.imdbRating || meta?.rating || meta?.score || '')
}

function extractYear(value) {
  return cleanText(value).match(/\b(19|20)\d{2}\b/)?.[0] || ''
}

function candidateTitle(candidate) {
  return cleanText(
    candidate?.name ||
    candidate?.title ||
    candidate?.originalName ||
    candidate?.originalTitle ||
    candidate?.original_name ||
    candidate?.original_title ||
    candidate?.trackName ||
    candidate?.collectionName ||
    candidate?.title_english ||
    candidate?.title_japanese ||
    candidate?.romaji ||
    candidate?.english ||
    candidate?.native ||
    ''
  )
}

function candidateDescription(candidate) {
  return cleanText([
    candidate?.description,
    candidate?.overview,
    candidate?.type,
    candidate?.kind,
    candidate?.genres,
    candidate?.genre,
    candidate?.primaryGenreName,
    candidate?.format,
    candidate?.mediaType
  ].flat().filter(Boolean).join(' '))
}

function candidateYear(candidate) {
  return extractYear(
    candidate?.year ||
    candidate?.premiered ||
    candidate?.released ||
    candidate?.first_air_date ||
    candidate?.releaseInfo ||
    candidate?.release_date ||
    candidate?.releaseDate ||
    candidate?.startDate?.year ||
    candidate?.aired?.from ||
    candidate?.published?.from ||
    candidate?.first_publish_year ||
    candidate?.description ||
    ''
  )
}

function candidateTypeScore(candidate, requestedType) {
  if (requestedType === 'book') return 0
  const text = normalizeCompare(candidateDescription(candidate))
  const candidateType = normalizeCompare(candidate?.type || candidate?.kind || '')
  const wantsSeries = requestedType === 'series'
  const wantsMovie = requestedType === 'movie'
  const looksSeries = /\b(series|show|tv|television|serie|miniseries|programa|anime|tv short|tv special)\b/.test(text) || candidateType.includes('series')
  const looksMovie = /\b(movie|film|pelicula|pelicula cinematografica|feature|feature movie)\b/.test(text) || candidateType.includes('movie')

  if (wantsSeries && looksSeries) return 60
  if (wantsMovie && looksMovie) return 60
  if (wantsSeries && looksMovie) return -140
  if (wantsMovie && looksSeries) return -140
  return 0
}

function tokenStats(left, right) {
  const leftTokens = left.split(' ').filter(Boolean)
  const rightTokens = right.split(' ').filter(Boolean)
  if (leftTokens.length === 0 || rightTokens.length === 0) return { shared: 0, coverage: 0, jaccard: 0 }

  const leftSet = new Set(leftTokens)
  const rightSet = new Set(rightTokens)
  const shared = [...leftSet].filter((token) => rightSet.has(token)).length
  const union = new Set([...leftSet, ...rightSet]).size
  return {
    shared,
    coverage: shared / leftSet.size,
    jaccard: union ? shared / union : 0
  }
}

function computeScore(candidate, title, year = '') {
  const baseTitle = normalizeCompare(title)
  const candidateTitleValue = candidateTitle(candidate)
  const normalizedCandidateTitle = normalizeCompare(candidateTitleValue)
  const looseBaseTitle = normalizeLooseTitle(title)
  const looseCandidateTitle = normalizeLooseTitle(candidateTitleValue)
  const baseYear = cleanText(year)
  const foundCandidateYear = candidateYear(candidate)

  let score = 0
  if (!normalizedCandidateTitle || !baseTitle) return score

  if (normalizedCandidateTitle === baseTitle) score += 170
  else if (looseCandidateTitle && looseCandidateTitle === looseBaseTitle) score += 145

  const stats = tokenStats(baseTitle, normalizedCandidateTitle)
  const baseTokenCount = baseTitle.split(' ').filter(Boolean).length
  score += Math.round(stats.coverage * 80)
  score += Math.round(stats.jaccard * 55)

  if (normalizedCandidateTitle.startsWith(`${baseTitle} `) || normalizedCandidateTitle.endsWith(` ${baseTitle}`)) score += 25
  if (baseTokenCount <= 2 && !normalizedCandidateTitle.startsWith(baseTitle) && normalizedCandidateTitle !== baseTitle) score -= 65
  if (baseTokenCount <= 2 && normalizedCandidateTitle.startsWith(`${baseTitle} `)) score += 35
  if (baseTitle.startsWith(`${normalizedCandidateTitle} `) && normalizedCandidateTitle.length >= 6) score += 10

  const lengthDelta = Math.abs(normalizedCandidateTitle.length - baseTitle.length)
  score -= Math.min(lengthDelta * 2, 45)

  if (stats.coverage < 0.65) score -= 90

  if (baseYear && foundCandidateYear) {
    const delta = Math.abs(Number(baseYear) - Number(foundCandidateYear))
    if (baseYear === foundCandidateYear) score += 135
    else if (delta <= 1) score += 35
    else if (delta <= 3) score -= 45
    else score -= 140
  } else if (baseYear && !foundCandidateYear) {
    score -= 25
  }

  score += candidateTypeScore(candidate, candidate?.requestedType || '')

  return score
}

function withRequestedType(candidate, requestedType) {
  return { ...(candidate || {}), requestedType }
}

function chooseBestCandidate(candidates, base, getCandidate = (entry) => entry, getExtraScore = () => 0) {
  const scored = (Array.isArray(candidates) ? candidates : [])
    .map((entry) => {
      const candidate = getCandidate(entry)
      return {
        entry,
        candidate,
        score: computeScore(withRequestedType(candidate, base.type), base.title, base.year) + Number(getExtraScore(entry) || 0)
      }
    })
    .filter((entry) => entry.candidate)
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  const second = scored[1]
  if (!best) return null

  const hasYear = Boolean(cleanText(base.year))
  const bestTitle = normalizeCompare(candidateTitle(best.candidate))
  const exactTitle = bestTitle === normalizeCompare(base.title) || normalizeLooseTitle(bestTitle) === normalizeLooseTitle(base.title)
  const minimumScore = hasYear ? 185 : exactTitle ? 145 : 165
  const margin = second ? best.score - second.score : Number.POSITIVE_INFINITY

  if (best.score < minimumScore) return null
  if (hasYear && second && margin < 20 && candidateYear(best.candidate) !== cleanText(base.year)) return null
  if (!hasYear && second && margin < 12 && !exactTitle) return null

  return best
}

async function fetchJson(url, params = null, timeout = REQUEST_TIMEOUT) {
  const { data } = await axios.get(url, {
    params: params || undefined,
    timeout,
    headers: DEFAULT_HEADERS,
    maxRedirects: 5
  })
  return data
}

async function postJson(url, body, timeout = REQUEST_TIMEOUT) {
  const { data } = await axios.post(url, body, {
    timeout,
    headers: {
      ...DEFAULT_HEADERS,
      'Content-Type': 'application/json'
    },
    maxRedirects: 5
  })
  return data
}

async function getCachedMetadata(key) {
  try {
    const store = await getStore()
    const cache = store.get('metadataCache', {})
    const cached = cache[key]
    if (!cached || Date.now() - Number(cached.updatedAt || 0) > CACHE_TTL) return null
    return cached.data || null
  } catch {
    return null
  }
}

async function setCachedMetadata(key, data) {
  try {
    const store = await getStore()
    const cache = store.get('metadataCache', {})
    cache[key] = { updatedAt: Date.now(), data }
    const keys = Object.keys(cache)
    if (keys.length > 700) {
      keys
        .sort((a, b) => Number(cache[a]?.updatedAt || 0) - Number(cache[b]?.updatedAt || 0))
        .slice(0, keys.length - 700)
        .forEach((oldKey) => delete cache[oldKey])
    }
    store.set('metadataCache', cache)
  } catch {
    // Metadata cache is an optimization; enrichment should still work without it.
  }
}

async function searchCinemeta(type, title) {
  const normalizedType = type === 'series' ? 'series' : 'movie'
  const url = `${CINEMETA_BASE_URL}/catalog/${normalizedType}/top/search=${encodeURIComponent(title)}.json`
  const data = await fetchJson(url)
  return Array.isArray(data?.metas) ? data.metas : []
}

async function getCinemetaMeta(type, id) {
  const normalizedType = type === 'series' ? 'series' : 'movie'
  const url = `${CINEMETA_BASE_URL}/meta/${normalizedType}/${id}.json`
  const data = await fetchJson(url)
  return data?.meta || null
}

async function enrichFromCinemeta(base) {
  try {
    const candidates = await searchCinemeta(base.type, base.title)
    const best = chooseBestCandidate(candidates, base)

    if (!best?.candidate) return null

    const meta = await getCinemetaMeta(base.type, best.candidate.imdb_id || best.candidate.id)
    const source = meta || best.candidate
    return {
      imdbId: normalizeImdbId(source.imdb_id || source.id || best.candidate.imdb_id || best.candidate.id),
      poster: cleanText(source.poster || best.candidate.poster || ''),
      synopsis: cleanText(source.description || source.overview || ''),
      genres: Array.isArray(source.genre) ? source.genre.map(cleanText).filter(Boolean) : [],
      duration: cleanText(source.runtime || ''),
      director: Array.isArray(source.director) ? source.director.map(cleanText).filter(Boolean).join(', ') : cleanText(source.director || ''),
      cast: Array.isArray(source.cast) ? source.cast.slice(0, 12).map(cleanText).filter(Boolean) : [],
      rating: ratingFromMeta(source),
      provider: 'cinemeta'
    }
  } catch {
    return null
  }
}

async function enrichSeriesFromTvmaze(base) {
  try {
    const search = await fetchJson(`${TVMAZE_BASE_URL}/search/shows`, { q: base.title })
    const best = chooseBestCandidate(
      search,
      base,
      (entry) => entry.show,
      (entry) => Number(entry.score || 0) * 35
    )

    if (!best?.candidate) return null

    const show = best.candidate
    const castData = await fetchJson(`${TVMAZE_BASE_URL}/shows/${show.id}/cast`).catch(() => [])
    return {
      poster: cleanText(show.image?.original || show.image?.medium || ''),
      synopsis: cleanText(show.summary || ''),
      genres: Array.isArray(show.genres) ? show.genres.map(cleanText).filter(Boolean) : [],
      duration: show.averageRuntime ? `${show.averageRuntime} min` : show.runtime ? `${show.runtime} min` : '',
      director: '',
      cast: Array.isArray(castData) ? castData.map((entry) => cleanText(entry?.person?.name)).filter(Boolean).slice(0, 12) : [],
      rating: show.rating?.average ? String(show.rating.average) : '',
      provider: 'tvmaze'
    }
  } catch {
    return null
  }
}

async function enrichBook(base) {
  try {
    const data = await fetchJson(OPEN_LIBRARY_URL, {
      q: base.title,
      limit: 10,
      language: 'spa'
    })
    const docs = Array.isArray(data?.docs) ? data.docs : []
    const best = chooseBestCandidate(docs, base, (doc) => ({
      ...doc,
      title: doc.title,
      year: doc.first_publish_year
    }))

    if (!best?.entry) return null

    const coverId = best.entry.cover_i
    return {
      poster: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
      synopsis: '',
      genres: Array.isArray(best.entry.subject) ? best.entry.subject.slice(0, 6).map(cleanText).filter(Boolean) : [],
      duration: '',
      director: '',
      cast: Array.isArray(best.entry.author_name) ? best.entry.author_name.slice(0, 4).map(cleanText).filter(Boolean) : [],
      rating: '',
      provider: 'openlibrary'
    }
  } catch {
    return null
  }
}

function wikidataSparqlForEntity(entityId) {
  return `
SELECT ?item ?itemLabel ?article ?image ?imdb ?directorLabel ?castLabel ?genreLabel WHERE {
  VALUES ?item { wd:${entityId} }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://es.wikipedia.org/>. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P345 ?imdb. }
  OPTIONAL { ?item wdt:P57 ?director. }
  OPTIONAL { ?item wdt:P161 ?cast. }
  OPTIONAL { ?item wdt:P136 ?genre. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
LIMIT 40`
}

async function enrichFromWikidata(base) {
  try {
    const searchData = await fetchJson(WIKIDATA_SEARCH_URL, {
      action: 'wbsearchentities',
      search: base.title,
      language: 'es',
      uselang: 'es',
      format: 'json',
      limit: 8
    })
    const candidates = Array.isArray(searchData?.search) ? searchData.search : []
    const best = chooseBestCandidate(candidates, base, (candidate) => ({
      name: candidate.label,
      year: candidate.description,
      description: candidate.description
    }))

    if (!best?.entry?.id) return null

    const sparql = await fetchJson(WIKIDATA_SPARQL_URL, {
      query: wikidataSparqlForEntity(best.entry.id),
      format: 'json'
    }, 12000)
    const rows = Array.isArray(sparql?.results?.bindings) ? sparql.results.bindings : []
    const first = rows[0] || {}
    const article = cleanText(first.article?.value || '')
    const directors = [...new Set(rows.map((row) => cleanText(row.directorLabel?.value)).filter(Boolean))].slice(0, 4)
    const cast = [...new Set(rows.map((row) => cleanText(row.castLabel?.value)).filter(Boolean))].slice(0, 12)
    const genres = [...new Set(rows.map((row) => cleanText(row.genreLabel?.value)).filter(Boolean))].slice(0, 8)
    let synopsis = ''
    let poster = ''

    if (article) {
      const title = decodeURIComponent(article.split('/wiki/')[1] || '').replace(/_/g, ' ')
      const summary = await fetchJson(`${WIKIPEDIA_SUMMARY_BASE}/${encodeURIComponent(title)}`).catch(() => null)
      synopsis = cleanText(summary?.extract || '')
      poster = cleanText(summary?.thumbnail?.source || summary?.originalimage?.source || '')
    }

    if (!poster && first.image?.value) {
      poster = `${COMMONS_FILE_BASE}/${encodeURIComponent(first.image.value.split('/').pop())}`
    }

    return {
      imdbId: normalizeImdbId(first.imdb?.value || ''),
      poster,
      synopsis,
      genres,
      duration: '',
      director: directors.join(', '),
      cast,
      rating: '',
      provider: 'wikidata'
    }
  } catch {
    return null
  }
}

async function enrichBookFromGutendex(base) {
  try {
    const data = await fetchJson(GUTENDEX_URL, { search: base.title })
    const results = Array.isArray(data?.results) ? data.results : []
    const best = chooseBestCandidate(results, base, (book) => ({
      title: book.title,
      year: '',
      description: [...(book.subjects || []), ...(book.bookshelves || [])].join(' ')
    }))

    if (!best?.entry) return null
    const book = best.entry
    return {
      poster: cleanText(book.formats?.['image/jpeg'] || ''),
      synopsis: '',
      genres: Array.isArray(book.subjects) ? book.subjects.slice(0, 8).map(cleanText).filter(Boolean) : [],
      duration: '',
      director: '',
      cast: Array.isArray(book.authors) ? book.authors.map((author) => cleanText(author.name)).filter(Boolean).slice(0, 4) : [],
      rating: '',
      provider: 'gutendex'
    }
  } catch {
    return null
  }
}

async function enrichFromItunes(base) {
  try {
    const entity = base.type === 'series' ? 'tvSeason' : 'movie'
    const data = await fetchJson(ITUNES_SEARCH_URL, {
      term: base.title,
      country: 'US',
      media: 'movie',
      entity,
      limit: 12
    })
    const results = Array.isArray(data?.results) ? data.results : []
    const best = chooseBestCandidate(results, base, (item) => ({
      ...item,
      title: item.trackName || item.collectionName,
      year: item.releaseDate,
      description: [item.kind, item.primaryGenreName, item.longDescription, item.shortDescription].filter(Boolean).join(' ')
    }))

    if (!best?.entry) return null
    const item = best.entry
    return {
      poster: cleanText(item.artworkUrl100 || '').replace('100x100bb', '1200x1200bb'),
      synopsis: cleanText(item.longDescription || item.shortDescription || ''),
      genres: item.primaryGenreName ? [cleanText(item.primaryGenreName)] : [],
      duration: item.trackTimeMillis ? `${Math.round(Number(item.trackTimeMillis) / 60000)} min` : '',
      director: cleanText(item.artistName || ''),
      cast: [],
      rating: '',
      provider: 'itunes'
    }
  } catch {
    return null
  }
}

async function enrichSeriesFromJikan(base) {
  try {
    const data = await fetchJson(JIKAN_ANIME_URL, {
      q: base.title,
      limit: 8
    })
    const results = Array.isArray(data?.data) ? data.data : []
    const best = chooseBestCandidate(results, base, (anime) => ({
      ...anime,
      title: anime.title_english || anime.title,
      year: anime.aired?.from,
      description: [anime.type, anime.synopsis, ...(anime.genres || []).map((genre) => genre.name)].join(' ')
    }))

    if (!best?.entry) return null
    const anime = best.entry
    return {
      poster: cleanText(anime.images?.jpg?.large_image_url || anime.images?.webp?.large_image_url || ''),
      synopsis: cleanText(anime.synopsis || ''),
      genres: Array.isArray(anime.genres) ? anime.genres.map((genre) => cleanText(genre.name)).filter(Boolean) : [],
      duration: cleanText(anime.duration || ''),
      director: '',
      cast: [],
      rating: anime.score ? String(anime.score) : '',
      provider: 'jikan'
    }
  } catch {
    return null
  }
}

async function enrichSeriesFromAnilist(base) {
  try {
    const query = `
query ($search: String) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: ANIME) {
      title { romaji english native }
      startDate { year }
      coverImage { extraLarge large }
      description(asHtml: false)
      genres
      averageScore
      duration
      format
    }
  }
}`
    const data = await postJson(ANILIST_GRAPHQL_URL, { query, variables: { search: base.title } }, 12000)
    const results = Array.isArray(data?.data?.Page?.media) ? data.data.Page.media : []
    const normalized = results.map((anime) => ({
      ...anime,
      title: anime.title?.english || anime.title?.romaji || anime.title?.native || '',
      year: anime.startDate?.year,
      description: [anime.format, anime.description, ...(anime.genres || [])].join(' ')
    }))
    const best = chooseBestCandidate(normalized, base)

    if (!best?.entry) return null
    const anime = best.entry
    return {
      poster: cleanText(anime.coverImage?.extraLarge || anime.coverImage?.large || ''),
      synopsis: cleanText(anime.description || ''),
      genres: Array.isArray(anime.genres) ? anime.genres.map(cleanText).filter(Boolean) : [],
      duration: anime.duration ? `${anime.duration} min` : '',
      director: '',
      cast: [],
      rating: anime.averageScore ? String(Math.round(Number(anime.averageScore)) / 10) : '',
      provider: 'anilist'
    }
  } catch {
    return null
  }
}

async function enrichMetadata(base) {
  const key = metadataCacheKey(base)
  const cached = await getCachedMetadata(key)
  if (cached) return cached

  let result
  if (base.type === 'book') {
    result = mergeMetadata(await enrichBook(base), await enrichBookFromGutendex(base), await enrichFromWikidata(base), EMPTY_METADATA)
  } else if (base.type === 'series') {
    result = mergeMetadata(
      await enrichSeriesFromTvmaze(base),
      await enrichSeriesFromAnilist(base),
      await enrichSeriesFromJikan(base),
      await enrichFromCinemeta(base),
      await enrichFromItunes(base),
      await enrichFromWikidata(base),
      EMPTY_METADATA
    )
  } else {
    result = mergeMetadata(
      await enrichFromCinemeta(base),
      await enrichFromItunes(base),
      await enrichFromWikidata(base),
      EMPTY_METADATA
    )
  }

  if (hasUsefulMetadata(result)) await setCachedMetadata(key, result)
  return result
}

async function searchMetadataOptions(base) {
  const options = []

  if (base.type === 'series') {
    const tvmaze = await fetchJson(`${TVMAZE_BASE_URL}/search/shows`, { q: base.title }).catch(() => [])
    for (const entry of Array.isArray(tvmaze) ? tvmaze.slice(0, 8) : []) {
      const show = entry.show
      const score = computeScore(withRequestedType(show, base.type), base.title, base.year) + Number(entry.score || 0) * 35
      if (score < 80) continue
      options.push(optionFromMetadata(show, 'tvmaze', score))
    }

    const anilistQuery = `
query ($search: String) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: ANIME) {
      title { romaji english native }
      startDate { year }
      coverImage { extraLarge large }
      description(asHtml: false)
      genres
      averageScore
      duration
      format
    }
  }
}`
    const anilist = await postJson(ANILIST_GRAPHQL_URL, { query: anilistQuery, variables: { search: base.title } }, 12000).catch(() => null)
    for (const anime of Array.isArray(anilist?.data?.Page?.media) ? anilist.data.Page.media : []) {
      const candidate = {
        ...anime,
        title: anime.title?.english || anime.title?.romaji || anime.title?.native || '',
        year: anime.startDate?.year,
        description: [anime.format, anime.description, ...(anime.genres || [])].join(' ')
      }
      const score = computeScore(withRequestedType(candidate, base.type), base.title, base.year)
      if (score < 80) continue
      options.push(optionFromMetadata(candidate, 'anilist', score))
    }

    const jikan = await fetchJson(JIKAN_ANIME_URL, { q: base.title, limit: 8 }).catch(() => null)
    for (const anime of Array.isArray(jikan?.data) ? jikan.data : []) {
      const candidate = {
        ...anime,
        title: anime.title_english || anime.title,
        year: anime.aired?.from,
        description: [anime.type, anime.synopsis, ...(anime.genres || []).map((genre) => genre.name)].join(' ')
      }
      const score = computeScore(withRequestedType(candidate, base.type), base.title, base.year)
      if (score < 80) continue
      options.push(optionFromMetadata(candidate, 'jikan', score))
    }
  }

  if (base.type !== 'book') {
    const cinemeta = await searchCinemeta(base.type, base.title).catch(() => [])
    for (const candidate of Array.isArray(cinemeta) ? cinemeta.slice(0, 8) : []) {
      const score = computeScore(withRequestedType(candidate, base.type), base.title, base.year)
      if (score < 80) continue
      const meta = await getCinemetaMeta(base.type, candidate.imdb_id || candidate.id).catch(() => null)
      options.push(optionFromMetadata(meta || candidate, 'cinemeta', score))
    }

    const itunes = await fetchJson(ITUNES_SEARCH_URL, {
      term: base.title,
      country: 'US',
      media: 'movie',
      entity: base.type === 'series' ? 'tvSeason' : 'movie',
      limit: 8
    }).catch(() => null)
    for (const item of Array.isArray(itunes?.results) ? itunes.results : []) {
      const candidate = {
        ...item,
        title: item.trackName || item.collectionName,
        year: item.releaseDate,
        description: [item.kind, item.primaryGenreName, item.longDescription, item.shortDescription].filter(Boolean).join(' ')
      }
      const score = computeScore(withRequestedType(candidate, base.type), base.title, base.year)
      if (score < 80) continue
      options.push(optionFromMetadata(candidate, 'itunes', score))
    }
  }

  if (base.type === 'book') {
    const openLibrary = await fetchJson(OPEN_LIBRARY_URL, { q: base.title, limit: 8, language: 'spa' }).catch(() => null)
    for (const doc of Array.isArray(openLibrary?.docs) ? openLibrary.docs : []) {
      const candidate = { ...doc, title: doc.title, year: doc.first_publish_year }
      const score = computeScore(withRequestedType(candidate, base.type), base.title, base.year)
      if (score < 80) continue
      options.push({
        provider: 'openlibrary',
        score,
        title: cleanText(doc.title),
        year: cleanText(doc.first_publish_year || ''),
        poster: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : '',
        synopsis: '',
        genres: Array.isArray(doc.subject) ? doc.subject.slice(0, 6).map(cleanText).filter(Boolean) : [],
        duration: '',
        director: '',
        cast: Array.isArray(doc.author_name) ? doc.author_name.slice(0, 4).map(cleanText).filter(Boolean) : [],
        rating: ''
      })
    }

    const gutendex = await fetchJson(GUTENDEX_URL, { search: base.title }).catch(() => null)
    for (const book of Array.isArray(gutendex?.results) ? gutendex.results.slice(0, 8) : []) {
      const candidate = {
        title: book.title,
        description: [...(book.subjects || []), ...(book.bookshelves || [])].join(' ')
      }
      const score = computeScore(withRequestedType(candidate, base.type), base.title, base.year)
      if (score < 80) continue
      options.push({
        provider: 'gutendex',
        score,
        title: cleanText(book.title),
        year: '',
        poster: cleanText(book.formats?.['image/jpeg'] || ''),
        synopsis: '',
        genres: Array.isArray(book.subjects) ? book.subjects.slice(0, 8).map(cleanText).filter(Boolean) : [],
        duration: '',
        director: '',
        cast: Array.isArray(book.authors) ? book.authors.map((author) => cleanText(author.name)).filter(Boolean).slice(0, 4) : [],
        rating: ''
      })
    }
  }

  const deduped = new Map()
  for (const option of options.filter(Boolean)) {
    const key = `${normalizeCompare(option.provider)}:${normalizeCompare(option.title)}:${option.year}:${option.poster}`
    const existing = deduped.get(key)
    if (!existing || option.score > existing.score) deduped.set(key, option)
  }

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

module.exports = {
  enrichMetadata,
  searchMetadataOptions
}
