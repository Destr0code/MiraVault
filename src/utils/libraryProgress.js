import { getProgressKey, progressPercent } from '@/store/watchProgressStore'

export const STATUS_LABELS = {
  pending: 'Pendiente',
  watching: 'Viendo',
  completed: 'Completada',
  paused: 'Pausada'
}

export function flattenEpisodes(item) {
  if (!item || item.type !== 'series' || !Array.isArray(item.seasons)) return []

  return item.seasons
    .flatMap((season) => (
      Array.isArray(season.episodes)
        ? season.episodes.map((episode) => ({ season, episode }))
        : []
    ))
    .sort((a, b) => {
      if (a.season.number !== b.season.number) return a.season.number - b.season.number
      return a.episode.number - b.episode.number
    })
}

export function buildEpisodePlayback(item, season, episode, mediaId) {
  return {
    filePath: episode.filePath,
    progressKey: getProgressKey(item, season.number, episode.number),
    title: `${item.title} - T${season.number}E${String(episode.number).padStart(2, '0')} ${episode.title}`,
    backTo: `/media/${encodeURIComponent(mediaId || item.id)}`,
    type: item.type,
    imdbId: item.imdbId || '',
    season: season.number,
    episode: episode.number
  }
}

export function getNextEpisode(item, seasonNumber, episodeNumber, mediaId) {
  const episodes = flattenEpisodes(item)
  const currentIndex = episodes.findIndex(({ season, episode }) => (
    season.number === seasonNumber && episode.number === episodeNumber
  ))
  const next = currentIndex >= 0 ? episodes[currentIndex + 1] : null
  return next ? buildEpisodePlayback(item, next.season, next.episode, mediaId) : null
}

export function getNextUnwatchedEpisode(item, progress = {}, mediaId) {
  for (const { season, episode } of flattenEpisodes(item)) {
    const key = getProgressKey(item, season.number, episode.number)
    if (!progress[key]?.watched) return buildEpisodePlayback(item, season, episode, mediaId)
  }
  return null
}

export function getItemProgressSummary(item, progress = {}) {
  if (!item) return { total: 0, watched: 0, partial: 0, percent: 0, current: null }

  if (item.type === 'series') {
    const episodes = flattenEpisodes(item)
    let watched = 0
    let partial = 0
    let current = null

    for (const { season, episode } of episodes) {
      const key = getProgressKey(item, season.number, episode.number)
      const value = progress[key]
      if (value?.watched) watched += 1
      else if (value?.currentTime > 0) {
        partial += 1
        if (!current || Number(value.updatedAt || 0) > Number(current.progress.updatedAt || 0)) {
          current = { key, season, episode, progress: value }
        }
      }
    }

    return {
      total: episodes.length,
      watched,
      partial,
      percent: episodes.length ? Math.round((watched / episodes.length) * 100) : 0,
      current
    }
  }

  const key = getProgressKey(item)
  const value = progress[key]
  return {
    total: 1,
    watched: value?.watched ? 1 : 0,
    partial: value?.currentTime > 0 && !value?.watched ? 1 : 0,
    percent: progressPercent(value),
    current: value ? { key, progress: value } : null
  }
}

export function getAutomaticStatus(item, progress = {}) {
  const summary = getItemProgressSummary(item, progress)
  if (summary.total > 0 && summary.watched >= summary.total) return 'completed'
  if (summary.watched > 0 || summary.partial > 0) return 'watching'
  return 'pending'
}

export function getEffectiveStatus(item, progress = {}, manualStatuses = {}) {
  const manual = manualStatuses?.[item?.id]
  return manual || getAutomaticStatus(item, progress)
}
