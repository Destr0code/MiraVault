import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { useFavoritesStore } from '@/store/favoritesStore'
import { useWatchProgressStore, getProgressKey, formatProgress, progressPercent } from '@/store/watchProgressStore'
import { useLibraryStatusStore } from '@/store/libraryStatusStore'
import { getEffectiveStatus, STATUS_LABELS } from '@/utils/libraryProgress'

function HeartIcon({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="m12 20-1.1-1C6 14.5 3 11.8 3 8.5A4.5 4.5 0 0 1 7.5 4 5 5 0 0 1 12 6.1 5 5 0 0 1 16.5 4 4.5 4.5 0 0 1 21 8.5c0 3.3-3 6-7.9 10.5L12 20Z" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
      <path d="M8 6v12l10-6-10-6Z" />
    </svg>
  )
}

function formatSize(bytes) {
  const value = Number(bytes || 0)
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${Math.round(value)} B`
}

function Poster({ detail }) {
  const [imageError, setImageError] = useState(false)

  if (detail?.poster && !imageError) {
    return (
      <img
        src={detail.poster}
        alt={detail.title}
        className="h-full w-full object-cover"
        onError={() => setImageError(true)}
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,var(--accent-muted),transparent)] px-8 text-center text-2xl font-semibold text-[color:var(--text-primary)]">
      {detail?.title || 'Sin portada'}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 10h13a4 4 0 0 1 0 8H7" />
      <path d="m7 6-4 4 4 4" />
    </svg>
  )
}

function MetadataEditor({ detail, onSave, onReset }) {
  const [open, setOpen] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [options, setOptions] = useState([])
  const [form, setForm] = useState({
    title: detail.title || '',
    year: detail.year || '',
    poster: detail.poster || '',
    synopsis: detail.synopsis || '',
    genres: detail.genres?.join(', ') || '',
    duration: detail.duration || '',
    director: detail.director || '',
    cast: detail.cast?.join(', ') || '',
    rating: detail.rating || ''
  })

  useEffect(() => {
    setForm({
      title: detail.title || '',
      year: detail.year || '',
      poster: detail.poster || '',
      synopsis: detail.synopsis || '',
      genres: detail.genres?.join(', ') || '',
      duration: detail.duration || '',
      director: detail.director || '',
      cast: detail.cast?.join(', ') || '',
      rating: detail.rating || ''
    })
  }, [detail])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    await onSave({
      ...form,
      genres: form.genres,
      cast: form.cast
    })
    setSaving(false)
    setOpen(false)
  }

  async function handleReset() {
    setSaving(true)
    await onReset()
    setSaving(false)
    setOpen(false)
  }

  async function searchOptions() {
    setSearching(true)
    const result = await window.electronAPI?.librarySearchMetadataOptions?.(detail.id)
    setOptions(Array.isArray(result?.options) ? result.options : [])
    setSearching(false)
  }

  async function useOption(option) {
    setSaving(true)
    await onSave(option)
    setSaving(false)
    setOpen(false)
  }

  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/35 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Metadata manual</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            {detail.manualOverride ? 'Usando una seleccion manual. No se pisa al reescanear.' : 'Elige entre varias opciones si el automatico falla.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const nextOpen = !open
            setOpen(nextOpen)
            if (nextOpen && options.length === 0) setTimeout(searchOptions, 0)
          }}
          className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]"
        >
          {open ? 'Cerrar opciones' : 'Cambiar datos'}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={searchOptions} disabled={searching} className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {searching ? 'Buscando...' : 'Buscar opciones'}
            </button>
            <button type="button" onClick={() => setAdvanced((value) => !value)} className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]">
              {advanced ? 'Ocultar manual' : 'Edicion manual'}
            </button>
            <button type="button" onClick={handleReset} disabled={saving} className="rounded-xl border border-[#e05555]/35 px-4 py-2 text-sm text-[#e05555] hover:bg-[#e05555]/10 disabled:opacity-50">
              Restaurar automatico
            </button>
          </div>

          {options.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {options.map((option, index) => (
                <article key={`${option.provider}-${option.title}-${option.year}-${index}`} className="flex gap-3 rounded-2xl border border-[color:var(--border)] bg-black/10 p-3">
                  <div className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-[color:var(--bg-secondary)]">
                    {option.poster ? <img src={option.poster} alt={option.title} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-[color:var(--text-primary)]">{option.title || 'Sin titulo'}</h3>
                      {option.year ? <span className="text-xs text-[color:var(--text-muted)]">{option.year}</span> : null}
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--accent)]">{option.provider}</p>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-[color:var(--text-secondary)]">{option.synopsis || 'Sin sinopsis.'}</p>
                    <button type="button" onClick={() => useOption(option)} disabled={saving} className="mt-3 rounded-xl bg-[color:var(--accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
                      Usar esta opcion
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-[color:var(--border)] bg-black/10 p-4 text-sm text-[color:var(--text-secondary)]">
              {searching ? 'Buscando coincidencias...' : 'No hay opciones cargadas todavia.'}
            </p>
          )}

          {advanced ? (
            <div className="space-y-4 border-t border-[color:var(--border)] pt-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_120px]">
                <input value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder="Titulo" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
                <input value={form.year} onChange={(event) => updateField('year', event.target.value)} placeholder="Ano" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
                <input value={form.rating} onChange={(event) => updateField('rating', event.target.value)} placeholder="Rating" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
              </div>
              <input value={form.poster} onChange={(event) => updateField('poster', event.target.value)} placeholder="URL de caratula" className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
              <textarea value={form.synopsis} onChange={(event) => updateField('synopsis', event.target.value)} rows={5} placeholder="Sinopsis" className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
              <div className="grid gap-3 md:grid-cols-2">
                <input value={form.genres} onChange={(event) => updateField('genres', event.target.value)} placeholder="Generos separados por coma" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
                <input value={form.duration} onChange={(event) => updateField('duration', event.target.value)} placeholder="Duracion" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
                <input value={form.director} onChange={(event) => updateField('director', event.target.value)} placeholder="Director" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
                <input value={form.cast} onChange={(event) => updateField('cast', event.target.value)} placeholder="Reparto separado por coma" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
              </div>
              <button type="button" onClick={handleSave} disabled={saving} className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar manual'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function FileActions({ filePath, onPlay, progressKey, title, playbackMeta }) {
  const progress = useWatchProgressStore((state) => state.progress[progressKey])
  const markWatched = useWatchProgressStore((state) => state.markWatched)
  const markUnwatched = useWatchProgressStore((state) => state.markUnwatched)
  const { show } = useToast()
  const pct = progressPercent(progress)

  async function handlePlay() {
    await onPlay({ filePath, progressKey, title, startTime: progress?.currentTime || 0, playbackMeta })
  }

  async function handleMarkWatched() {
    await markWatched(progressKey)
    show('Marcado como visto', 'success')
  }

  async function handleMarkUnwatched() {
    await markUnwatched(progressKey)
    show('Marcado como no visto', 'info')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handlePlay}
        className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--accent)] px-3 py-2 text-xs font-medium text-white transition hover:brightness-110"
      >
        <PlayIcon />
        {progress && !progress.watched && progress.currentTime > 0 ? 'Continuar' : 'Reproducir'}
      </button>
      <button
        type="button"
        onClick={() => window.electronAPI?.openFolder?.(filePath.replace(/\\[^\\]+$/, ''))}
        className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-hover)]"
      >
        <FolderIcon />
        Carpeta
      </button>
      {progress?.watched ? (
        <button
          type="button"
          onClick={handleMarkUnwatched}
          className="inline-flex items-center gap-1 rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-hover)]"
        >
          <UndoIcon />
          No visto
        </button>
      ) : (
        <button
          type="button"
          onClick={handleMarkWatched}
          className="inline-flex items-center gap-1 rounded-xl border border-[#1f8b58]/40 px-3 py-2 text-xs text-[#84d49c] transition hover:bg-[#1f8b58]/15"
        >
          <CheckIcon />
          Visto
        </button>
      )}
    </div>
  )
}

export default function MediaDetails() {
  const { mediaId } = useParams()
  const location = useLocation()
  const { show } = useToast()
  const favorites = useFavoritesStore((state) => state.favorites)
  const addFavorite = useFavoritesStore((state) => state.addFavorite)
  const removeFavorite = useFavoritesStore((state) => state.removeFavorite)
  const [detail, setDetail] = useState(location.state?.item || null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedSeason, setExpandedSeason] = useState(null)

  const progress = useWatchProgressStore((state) => state.progress)
  const statuses = useLibraryStatusStore((state) => state.statuses)
  const setStatus = useLibraryStatusStore((state) => state.setStatus)
  const isFavorite = useMemo(
    () => favorites.some((entry) => entry.id === mediaId),
    [favorites, mediaId]
  )
  const effectiveStatus = detail ? getEffectiveStatus(detail, progress, statuses) : 'pending'
  const manualStatus = statuses[mediaId] || 'auto'

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await window.electronAPI?.libraryGetItem?.(mediaId)
        if (cancelled) return
        if (!data) {
          setError('No se encontro este contenido en tu biblioteca.')
          return
        }

        setDetail(data)
        if (Array.isArray(data.seasons) && data.seasons.length > 0) {
          setExpandedSeason(data.seasons[0].number)
        }
      } catch {
        if (!cancelled) setError('No se pudo cargar la ficha local.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [mediaId])

  async function handlePlay({ filePath, progressKey, title, startTime = 0, nextEpisode = null, playbackMeta = {} }) {
    const result = await window.electronAPI?.playerOpenTracked?.({
      filePath,
      progressKey,
      title,
      startTime,
      nextEpisode,
      backTo: `/media/${encodeURIComponent(mediaId)}`,
      ...playbackMeta
    })

    if (result?.ok) {
      const subtitleLabel = result.subtitle?.lang ? ` con subtitulos ${result.subtitle.lang.toUpperCase()}` : ''
      show((startTime > 0 ? 'Continuando en VLC' : 'Reproduciendo en VLC') + subtitleLabel, 'success')
      return
    }

    show(result?.error || 'No se pudo abrir VLC.', 'error')
  }

  function getNextEpisode(seasonNumber, episodeNumber) {
    if (!detail?.seasons?.length) return null

    const episodes = detail.seasons
      .flatMap((season) => season.episodes.map((episode) => ({ season, episode })))
      .sort((a, b) => {
        if (a.season.number !== b.season.number) return a.season.number - b.season.number
        return a.episode.number - b.episode.number
      })

    const currentIndex = episodes.findIndex(({ season, episode }) => (
      season.number === seasonNumber && episode.number === episodeNumber
    ))
    const next = currentIndex >= 0 ? episodes[currentIndex + 1] : null
    if (!next) return null

    return {
      filePath: next.episode.filePath,
      progressKey: getProgressKey(detail, next.season.number, next.episode.number),
      title: `${detail.title} - T${next.season.number}E${String(next.episode.number).padStart(2, '0')} ${next.episode.title}`,
      backTo: `/media/${encodeURIComponent(mediaId)}`,
      type: detail.type,
      imdbId: detail.imdbId || '',
      season: next.season.number,
      episode: next.episode.number
    }
  }

  function toggleFavorite() {
    if (!detail) return

    if (isFavorite) {
      removeFavorite(detail.id)
      show('Eliminado de favoritos', 'info')
      return
    }

    addFavorite(detail)
    show('Anadido a favoritos', 'success')
  }

  async function saveMetadataOverride(data) {
    const result = await window.electronAPI?.libraryUpdateMetadataOverride?.(mediaId, data)
    if (!result?.ok) {
      show(result?.error || 'No se pudieron guardar los datos', 'error')
      return
    }
    setDetail(result.item)
    show('Datos guardados', 'success')
  }

  async function resetMetadataOverride() {
    const result = await window.electronAPI?.libraryClearMetadataOverride?.(mediaId)
    if (!result?.ok) {
      show(result?.error || 'No se pudo restaurar metadata automatica', 'error')
      return
    }
    setDetail(result.item)
    show('Metadata automatica restaurada', 'info')
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
          <Spinner size="md" />
          Cargando ficha...
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <EmptyState
        icon={<HeartIcon filled={false} />}
        title="No se pudo abrir la ficha"
        description={error || 'No hay suficiente informacion para este contenido.'}
        action={(
          <Link
            to="/home"
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Volver a la biblioteca
          </Link>
        )}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/home" className="text-sm text-[color:var(--accent)] hover:underline">
          Volver a la biblioteca
        </Link>
        <button
          type="button"
          onClick={toggleFavorite}
          className={[
            'flex h-11 w-11 items-center justify-center rounded-full border transition',
            isFavorite
              ? 'border-[#e05555] bg-[#e05555]/15 text-[#e05555]'
              : 'border-[color:var(--border)] text-[color:var(--text-secondary)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]'
          ].join(' ')}
        >
          <HeartIcon filled={isFavorite} />
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[20px] border border-[color:var(--border)] bg-[color:var(--bg-card)]">
          <div className="aspect-[2/3]">
            <Poster detail={detail} />
          </div>
        </div>

        <div className="space-y-5">
          <header className="space-y-3">
            <h1 className="text-4xl font-semibold text-[color:var(--text-primary)]">{detail.title}</h1>
            <div className="flex flex-wrap gap-3 text-sm text-[color:var(--text-secondary)]">
              {detail.year ? <span>{detail.year}</span> : null}
              {detail.quality ? <span>{detail.quality}</span> : null}
              {detail.language ? <span>{detail.language}</span> : null}
              {detail.duration ? <span>{detail.duration}</span> : null}
              {detail.rating ? <span>IMDb {detail.rating}</span> : null}
              <span className="uppercase text-[color:var(--accent)]">local</span>
            </div>
            {detail.genres?.length ? (
              <div className="flex flex-wrap gap-2">
                {detail.genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--text-secondary)]"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            ) : null}
          </header>

          {detail.synopsis ? (
            <section>
              <h2 className="mb-2 text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Sinopsis</h2>
              <p className="text-sm leading-7 text-[color:var(--text-secondary)]">{detail.synopsis}</p>
            </section>
          ) : null}

          <section className="grid gap-4 md:grid-cols-3">
            <div>
              <h2 className="mb-2 text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Director</h2>
              <p className="text-sm text-[color:var(--text-primary)]">{detail.director || 'No disponible'}</p>
            </div>
            <div>
              <h2 className="mb-2 text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Reparto</h2>
              <p className="text-sm text-[color:var(--text-primary)]">
                {detail.cast?.length ? detail.cast.join(', ') : 'No disponible'}
              </p>
            </div>
            <div>
              <h2 className="mb-2 text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Tamano</h2>
              <p className="text-sm text-[color:var(--text-primary)]">{formatSize(detail.totalSize)}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/35 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Estado</h2>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  Actual: <span className="text-[color:var(--accent)]">{STATUS_LABELS[effectiveStatus]}</span>
                </p>
              </div>
              <select
                value={manualStatus}
                onChange={(event) => {
                  setStatus(mediaId, event.target.value)
                  show('Estado actualizado', 'success')
                }}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
              >
                <option value="auto">Automatico</option>
                <option value="pending">Pendiente</option>
                <option value="watching">Viendo</option>
                <option value="completed">Completada</option>
                <option value="paused">Pausada</option>
              </select>
            </div>
          </section>

          <MetadataEditor detail={detail} onSave={saveMetadataOverride} onReset={resetMetadataOverride} />

          {detail.type === 'series' ? (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Temporadas</h2>
              {detail.seasons?.map((season) => {
                const expanded = expandedSeason === season.number
                const watchedCount = season.episodes.filter((ep) => {
                  const epKey = getProgressKey(detail, season.number, ep.number)
                  return progress[epKey]?.watched
                }).length
                const totalCount = season.episodes.length
                const allWatched = watchedCount === totalCount && totalCount > 0
                return (
                  <div
                    key={season.number}
                    className={[
                      'overflow-hidden rounded-2xl border',
                      allWatched ? 'border-[#1f8b58]/30' : 'border-[color:var(--border)]',
                      'bg-[color:var(--bg-card)]/35'
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedSeason(expanded ? null : season.number)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className={['font-medium', allWatched ? 'text-[#84d49c]' : 'text-[color:var(--text-primary)]'].join(' ')}>
                          Temporada {season.number}
                        </span>
                        {allWatched ? (
                          <span className="rounded-full bg-[#1f8b58]/20 px-2 py-0.5 text-[10px] text-[#84d49c]">Completada</span>
                        ) : watchedCount > 0 ? (
                          <span className="rounded-full bg-[color:var(--accent-muted)] px-2 py-0.5 text-[10px] text-[color:var(--accent)]">{watchedCount}/{totalCount}</span>
                        ) : null}
                      </div>
                      <span className="text-sm text-[color:var(--text-secondary)]">{totalCount} episodios</span>
                    </button>

                    {expanded ? (
                      <div className="space-y-3 border-t border-[color:var(--border)] px-4 py-4">
                        {season.episodes.map((episode) => {
                          const epKey = getProgressKey(detail, season.number, episode.number)
                          const epProgress = progress[epKey]
                          const epPct = progressPercent(epProgress)
                          return (
                            <div
                              key={`${season.number}-${episode.number}-${episode.filePath}`}
                              className="flex flex-col gap-3 rounded-2xl border border-[color:var(--border)] bg-black/10 p-4 lg:flex-row lg:items-center lg:justify-between"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-3">
                                  <p className={[
                                    'text-sm font-medium',
                                    epProgress?.watched ? 'text-[color:var(--text-muted)]' : 'text-[color:var(--text-primary)]'
                                  ].join(' ')}>
                                    E{String(episode.number).padStart(2, '0')} {episode.title}
                                  </p>
                                  {epProgress?.watched ? (
                                    <span className="rounded-full bg-[#1f8b58]/20 px-2 py-0.5 text-[10px] text-[#84d49c]">Visto</span>
                                  ) : null}
                                  {epProgress && !epProgress.watched && epPct > 0 ? (
                                    <span className="rounded-full bg-[color:var(--accent-muted)] px-2 py-0.5 text-[10px] text-[color:var(--accent)]">{epPct}%</span>
                                  ) : null}
                                </div>
                                <p className="mt-1 truncate text-xs text-[color:var(--text-muted)]">{episode.filePath}</p>
                                {epPct > 0 && epPct < 100 ? (
                                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/20">
                                    <div
                                      className="h-full rounded-full bg-[color:var(--accent)]"
                                      style={{ width: `${epPct}%` }}
                                    />
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap items-center gap-3">
                                {episode.quality ? <span className="text-xs text-[color:var(--text-secondary)]">{episode.quality}</span> : null}
                                {episode.language ? <span className="text-xs text-[color:var(--text-secondary)]">{episode.language}</span> : null}
                                <span className="text-xs text-[color:var(--text-secondary)]">{formatSize(episode.size)}</span>
                                <FileActions
                                  filePath={episode.filePath}
                                  onPlay={(payload) => handlePlay({
                                    ...payload,
                                    nextEpisode: getNextEpisode(season.number, episode.number)
                                  })}
                                  progressKey={epKey}
                                  title={`${detail.title} - T${season.number}E${String(episode.number).padStart(2, '0')} ${episode.title}`}
                                  playbackMeta={{
                                    type: detail.type,
                                    imdbId: detail.imdbId || '',
                                    season: season.number,
                                    episode: episode.number
                                  }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </section>
          ) : (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Archivos</h2>
              {detail.files?.map((file) => {
                const fileKey = getProgressKey(detail)
                const fileProgress = progress[fileKey]
                const filePct = progressPercent(fileProgress)
                return (
                  <div
                    key={file.path}
                    className="flex flex-col gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/35 p-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <p className={[
                          'truncate text-sm font-medium',
                          fileProgress?.watched ? 'text-[color:var(--text-muted)]' : 'text-[color:var(--text-primary)]'
                        ].join(' ')}>
                          {file.path.split('\\').pop()}
                        </p>
                        {fileProgress?.watched ? (
                          <span className="shrink-0 rounded-full bg-[#1f8b58]/20 px-2 py-0.5 text-[10px] text-[#84d49c]">Visto</span>
                        ) : null}
                        {fileProgress && !fileProgress.watched && filePct > 0 ? (
                          <span className="shrink-0 rounded-full bg-[color:var(--accent-muted)] px-2 py-0.5 text-[10px] text-[color:var(--accent)]">{filePct}%</span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-[color:var(--text-muted)]">{file.path}</p>
                      {filePct > 0 && filePct < 100 ? (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/20">
                          <div
                            className="h-full rounded-full bg-[color:var(--accent)]"
                            style={{ width: `${filePct}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {file.quality ? <span className="text-xs text-[color:var(--text-secondary)]">{file.quality}</span> : null}
                      {file.language ? <span className="text-xs text-[color:var(--text-secondary)]">{file.language}</span> : null}
                      <span className="text-xs text-[color:var(--text-secondary)]">{formatSize(file.size)}</span>
                      <FileActions
                        filePath={file.path}
                        onPlay={handlePlay}
                        progressKey={fileKey}
                        title={detail.title}
                        playbackMeta={{
                          type: detail.type,
                          imdbId: detail.imdbId || ''
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
