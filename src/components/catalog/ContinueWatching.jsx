import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWatchProgressStore, progressPercent } from '@/store/watchProgressStore'
import { getItemProgressSummary, getNextUnwatchedEpisode } from '@/utils/libraryProgress'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
      <path d="M8 6v12l10-6-10-6Z" />
    </svg>
  )
}

function formatTimeShort(seconds) {
  const s = Math.floor(Number(seconds) || 0)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

export default function ContinueWatching() {
  const progress = useWatchProgressStore((state) => state.progress)
  const [libraryItems, setLibraryItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { show } = useToast()

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const data = await window.electronAPI?.libraryList?.()
        if (mounted) setLibraryItems(Array.isArray(data) ? data : [])
      } catch {
        if (mounted) setLibraryItems([])
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const continueItems = useMemo(() => {
    const result = []

    for (const item of libraryItems) {
      const summary = getItemProgressSummary(item, progress)

      if (summary.current?.progress?.currentTime > 0 && !summary.current.progress.watched) {
        const isEpisode = Boolean(summary.current.episode)
        const label = isEpisode
          ? `${item.title} · T${summary.current.season.number}xE${String(summary.current.episode.number).padStart(2, '0')}`
          : item.title

        result.push({
          key: summary.current.key,
          mediaId: item.id,
          label,
          subtitle: isEpisode ? summary.current.episode.title : 'Continuar reproduccion',
          type: 'continue',
          progress: summary.current.progress,
          pct: progressPercent(summary.current.progress),
          filePath: isEpisode ? summary.current.episode.filePath : item.files?.[0]?.path || '',
          nextEpisode: isEpisode ? getNextUnwatchedEpisode(item, progress, item.id) : null,
          playbackMeta: isEpisode
            ? { type: item.type, imdbId: item.imdbId || '', season: summary.current.season.number, episode: summary.current.episode.number }
            : { type: item.type, imdbId: item.imdbId || '' },
          updatedAt: summary.current.progress.updatedAt || 0
        })
        continue
      }

      if (item.type === 'series' && (summary.watched > 0 || summary.partial > 0) && summary.watched < summary.total) {
        const next = getNextUnwatchedEpisode(item, progress, item.id)
        if (next) {
          result.push({
            key: next.progressKey,
            mediaId: item.id,
            label: item.title,
            subtitle: next.title.replace(`${item.title} - `, ''),
            type: 'next',
            progress: { currentTime: 0, duration: 0, updatedAt: item.updatedAt || 0 },
            pct: summary.percent,
            filePath: next.filePath,
            nextEpisode: null,
            playbackMeta: {
              type: item.type,
              imdbId: item.imdbId || '',
              season: next.season,
              episode: next.episode
            },
            updatedAt: item.updatedAt || 0
          })
        }
      }
    }

    result.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    return result.slice(0, 12)
  }, [progress, libraryItems])

  if (loading) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Seguir viendo</h2>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
            <Spinner size="sm" />
            Cargando...
          </div>
        </div>
      </section>
    )
  }

  if (continueItems.length === 0) return null

  async function handleResume(entry) {
    const result = await window.electronAPI?.playerOpenTracked?.({
      filePath: entry.filePath,
      progressKey: entry.key,
      title: entry.label,
      startTime: entry.type === 'continue' ? entry.progress.currentTime : 0,
      nextEpisode: entry.nextEpisode,
      backTo: `/media/${encodeURIComponent(entry.mediaId)}`,
      ...entry.playbackMeta
    })

    if (result?.ok) {
      const subtitleLabel = result.subtitle?.lang ? ` con subtitulos ${result.subtitle.lang.toUpperCase()}` : ''
      show((entry.type === 'continue' ? 'Continuando en VLC' : 'Reproduciendo en VLC') + subtitleLabel, 'success')
      return
    }

    show(result?.error || 'No se pudo abrir VLC.', 'error')
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Seguir viendo</h2>
        <span className="text-xs text-[color:var(--text-muted)]">{continueItems.length} pendientes</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {continueItems.map((entry) => (
          <article
            key={`${entry.type}-${entry.key}`}
            className="group flex w-[280px] shrink-0 flex-col overflow-hidden rounded-[16px] border border-[color:var(--border)] bg-[color:var(--bg-card)] transition-all hover:border-[color:var(--accent)] hover:shadow-[0_14px_30px_rgba(0,0,0,0.25)]"
          >
            <button
              type="button"
              className="px-4 pt-3 pb-2 text-left"
              onClick={() => navigate(`/media/${encodeURIComponent(entry.mediaId)}`)}
            >
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-[color:var(--text-primary)]">{entry.label}</p>
                <span className="shrink-0 rounded-full bg-[color:var(--accent-muted)] px-2 py-0.5 text-[10px] text-[color:var(--accent)]">
                  {entry.type === 'continue' ? 'En curso' : 'Siguiente'}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-[color:var(--text-muted)]">{entry.subtitle}</p>
            </button>

            <div className="mx-4 mb-2 h-2 overflow-hidden rounded-full bg-black/20">
              <div
                className="h-full rounded-full bg-[color:var(--accent)]"
                style={{ width: `${entry.type === 'continue' ? entry.pct : Math.max(entry.pct, 8)}%` }}
              />
            </div>

            <div className="flex items-center justify-between px-4 pb-3">
              <span className="text-xs text-[color:var(--text-secondary)]">
                {entry.type === 'continue'
                  ? `${formatTimeShort(entry.progress.currentTime)}${entry.pct > 0 ? ` · ${entry.pct}%` : ''}`
                  : `${entry.pct}% completado`}
              </span>
              <button
                type="button"
                onClick={() => handleResume(entry)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
              >
                <PlayIcon />
                {entry.type === 'continue' ? 'Continuar' : 'Ver'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
