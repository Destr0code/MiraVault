import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import EmptyState from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { formatProgress, useWatchProgressStore } from '@/store/watchProgressStore'

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="M8 6v12l10-6-10-6Z" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function RewindIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="M11 8v8l-6-4 6-4Zm8 0v8l-6-4 6-4Z" />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="M13 8v8l6-4-6-4ZM5 8v8l6-4-6-4Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
      <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />
    </svg>
  )
}

function filePathToUrl(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const parts = normalized.split('/').map((part, index) => {
    if (index === 0 && /^[A-Za-z]:$/.test(part)) return part
    return encodeURIComponent(part)
  })
  return `file:///${parts.join('/')}`
}

export default function Player() {
  const location = useLocation()
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const lastSavedRef = useRef(0)
  const loadedRef = useRef(false)
  const trackedRef = useRef(false)
  const { show } = useToast()
  const updateProgress = useWatchProgressStore((state) => state.updateProgress)
  const markWatched = useWatchProgressStore((state) => state.markWatched)
  const progress = useWatchProgressStore((state) => state.progress)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playMode, setPlayMode] = useState('checking')
  const [needsUserPlay, setNeedsUserPlay] = useState(false)
  const [audioWarning, setAudioWarning] = useState(false)

  const playback = location.state || {}
  const filePath = playback.filePath || ''
  const progressKey = playback.progressKey || ''
  const title = playback.title || 'Reproductor'
  const backTo = playback.backTo || '/home'
  const nextEpisode = playback.nextEpisode || null
  const savedProgress = progressKey ? progress[progressKey] : null
  const startTime = Number(playback.startTime ?? savedProgress?.currentTime ?? 0)
  const src = useMemo(() => filePathToUrl(filePath), [filePath])
  const secondsLeft = duration > 0 ? Math.max(0, Math.ceil(duration - currentTime)) : null
  const showNextEpisode = Boolean(nextEpisode && secondsLeft != null && secondsLeft <= 20 && secondsLeft > 0)

  useEffect(() => {
    let cancelled = false
    loadedRef.current = false
    trackedRef.current = false
    setPlayMode('checking')
    setNeedsUserPlay(false)
    setAudioWarning(false)
    setCurrentTime(0)
    setDuration(0)

    const openTracked = async () => {
      let result = null

      try {
        result = await window.electronAPI?.playerOpenTracked?.({
          filePath,
          progressKey,
          title,
          startTime,
          nextEpisode,
          backTo,
          type: playback.type,
          imdbId: playback.imdbId,
          season: playback.season,
          episode: playback.episode
        })
      } catch {
        result = { ok: false, fallback: true }
      }

      if (cancelled) {
        if (result?.ok && window.electronAPI?.playerStopTracked) {
          try {
            await window.electronAPI.playerStopTracked()
          } catch {
            // Ignore cleanup errors while leaving the player route.
          }
        }
        return
      }

      if (result?.ok) {
        trackedRef.current = true
        setPlayMode('vlc')
        return
      }

      setPlayMode('internal')
    }

    if (filePath && progressKey) openTracked()
    else setPlayMode('internal')

    return () => {
      cancelled = true
    }
  }, [filePath, progressKey, startTime, title, backTo])

  async function savePosition(force = false) {
    const video = videoRef.current
    if (!video || !progressKey || !Number.isFinite(video.currentTime)) return

    const now = Date.now()
    if (!force && now - lastSavedRef.current < 5000) return
    lastSavedRef.current = now

    const videoDuration = Number.isFinite(video.duration) ? video.duration : duration
    const nearEnd = videoDuration > 0 && video.currentTime >= videoDuration - 60

    if (nearEnd && videoDuration > 90) {
      await markWatched(progressKey)
      return
    }

    await updateProgress(progressKey, {
      watched: false,
      currentTime: Math.floor(video.currentTime),
      duration: Math.floor(videoDuration || 0)
    })
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (!video) return

    const videoDuration = Number.isFinite(video.duration) ? video.duration : 0
    setDuration(videoDuration)

    const audioTracks = video.audioTracks
    if (audioTracks && audioTracks.length === 0) {
      setAudioWarning(true)
    }

    if (!loadedRef.current && startTime > 0 && startTime < videoDuration - 10) {
      video.currentTime = startTime
      loadedRef.current = true
      show('Reanudando desde ' + formatProgress({ currentTime: startTime, duration: videoDuration }), 'info')
    }
  }

  async function handleCanPlay() {
    const video = videoRef.current
    if (!video || playMode !== 'internal') return

    video.muted = false
    video.volume = 1

    try {
      await video.play()
      setNeedsUserPlay(false)
      window.setTimeout(() => {
        const current = videoRef.current
        if (!current || playMode !== 'internal') return
        const tracks = current.audioTracks
        if (tracks && tracks.length === 0) setAudioWarning(true)
      }, 2500)
    } catch {
      setNeedsUserPlay(true)
    }
  }

  async function handleManualPlay() {
    const video = videoRef.current
    if (!video) return
    video.muted = false
    video.volume = 1
    try {
      await video.play()
      setNeedsUserPlay(false)
    } catch {
      show('No se pudo iniciar el audio en el reproductor interno. Prueba con VLC o reproductor externo.', 'error')
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(video.currentTime)
    if (Number.isFinite(video.duration)) setDuration(video.duration)
    savePosition(false)
  }

  async function handleEnded() {
    if (progressKey) {
      await markWatched(progressKey)
      show('Marcado como visto', 'success')
    }
  }

  async function handleNextEpisode() {
    if (!nextEpisode) return
    await markWatched(progressKey)
    navigate('/player', {
      replace: true,
      state: {
        ...nextEpisode,
        startTime: 0
      }
    })
  }

  async function handleExternalOpen() {
    const result = await window.electronAPI?.playerOpen?.(filePath, currentTime || startTime || 0, {
      title,
      type: playback.type,
      imdbId: playback.imdbId,
      season: playback.season,
      episode: playback.episode
    })
    if (!result?.ok) {
      show(result?.error || 'No se pudo abrir el reproductor externo.', 'error')
    }
  }

  async function sendMpvCommand(action, value) {
    const result = await window.electronAPI?.playerCommandTracked?.({ action, value })
    if (!result?.ok) {
      show(result?.error || 'No se pudo controlar VLC.', 'error')
    }
    return result
  }

  async function stopMpvAndGoBack() {
    navigate(backTo)
  }

  async function switchToInternalPlayer() {
    await window.electronAPI?.playerStopTracked?.()
    trackedRef.current = false
    setPlayMode('internal')
  }

  function seekBy(seconds) {
    const video = videoRef.current
    if (!video) return

    const nextTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, video.currentTime + seconds))
    video.currentTime = nextTime
    setCurrentTime(nextTime)
    savePosition(true)
  }

  useEffect(() => {
    return () => {
      savePosition(true)
    }
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') savePosition(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isTyping) return

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (playMode === 'vlc') sendMpvCommand('seekRelative', 5)
        else seekBy(5)
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (playMode === 'vlc') sendMpvCommand('seekRelative', -5)
        else seekBy(-5)
      }
      if (event.key === ' ' && playMode === 'vlc') {
        event.preventDefault()
        sendMpvCommand('togglePause')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playMode])

  if (!filePath || !progressKey) {
    return (
      <EmptyState
        icon={<PlayIcon />}
        title="No se pudo abrir el reproductor"
        description="Falta la ruta del archivo o la clave de progreso."
        action={<Link to="/home" className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white">Volver</Link>}
      />
    )
  }

  if (playMode === 'checking') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-sm text-white/65">
        Preparando reproductor...
      </div>
    )
  }

  if (playMode === 'vlc') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(91,110,245,0.18),transparent_32%),#07070a] p-6 text-white">
        <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-white/[0.055] p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--accent)] text-white shadow-[0_18px_45px_rgba(91,110,245,0.35)]">
            <PlayIcon />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-white/45">VLC externo abierto</p>
          <h1 className="mt-3 truncate text-2xl font-semibold">{title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/55">
            Usa los controles nativos de VLC para pantalla completa, audio, subtitulos y seek. MiraVault seguira guardando el progreso automaticamente mientras VLC este abierto.
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={stopMpvAndGoBack}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:scale-[1.02]"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => sendMpvCommand('togglePause')}
              className="rounded-full bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
            >
              Pausa / Play
            </button>
            <button
              type="button"
              onClick={() => sendMpvCommand('seekRelative', -5)}
              className="rounded-full bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
            >
              -5s
            </button>
            <button
              type="button"
              onClick={() => sendMpvCommand('seekRelative', 5)}
              className="rounded-full bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
            >
              +5s
            </button>
            <button
              type="button"
              onClick={async () => {
                await sendMpvCommand('quit')
                trackedRef.current = false
                navigate(backTo)
              }}
              className="rounded-full bg-[#e05555]/90 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#e05555]"
            >
              Cerrar VLC
            </button>
          </div>

          <p className="mt-5 text-xs text-white/35">Atajos VLC utiles: F pantalla completa, Space pausa, flechas seek, Ctrl+Q cerrar.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative h-full w-full bg-black">
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="pointer-events-auto rounded-full bg-black/55 px-4 py-2 text-sm text-white transition hover:bg-white/15"
        >
          Volver
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-white/80">{title}</p>
        <button
          type="button"
          onClick={handleExternalOpen}
          className="pointer-events-auto rounded-full bg-black/55 px-4 py-2 text-sm text-white transition hover:bg-white/15"
        >
          Externo
        </button>
      </div>

      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        preload="auto"
        className="h-full w-full bg-black object-contain"
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onTimeUpdate={handleTimeUpdate}
        onPause={() => savePosition(true)}
        onEnded={handleEnded}
        onError={() => show('Este formato no se puede reproducir dentro de la app. Prueba con Abrir externo.', 'error')}
      />

      {audioWarning ? (
        <div className="absolute left-1/2 top-6 z-30 w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border border-[#80652c] bg-black/90 p-4 text-center text-white shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <p className="text-sm font-semibold">Este archivo parece no tener audio compatible con el reproductor interno.</p>
          <p className="mt-1 text-xs text-white/60">Abre con VLC para reproducir pistas AC3, EAC3, DTS u otros codecs de MKV.</p>
          <button
            type="button"
            onClick={handleExternalOpen}
            className="mt-3 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:scale-[1.02]"
          >
            Abrir con VLC
          </button>
        </div>
      ) : null}

      {needsUserPlay ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55">
          <button
            type="button"
            onClick={handleManualPlay}
            className="inline-flex items-center gap-3 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black shadow-[0_18px_50px_rgba(0,0,0,0.45)] transition hover:scale-[1.02]"
          >
            <PlayIcon />
            Reproducir con sonido
          </button>
        </div>
      ) : null}

      {showNextEpisode ? (
        <div className="absolute bottom-16 right-6 z-20 max-w-[300px] rounded-2xl border border-white/15 bg-black/85 p-4 text-white shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.18em] text-white/55">Siguiente episodio</p>
          <p className="mt-2 line-clamp-2 text-sm font-medium">{nextEpisode.title}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-white/60">{secondsLeft}s restantes</span>
            <button
              type="button"
              onClick={handleNextEpisode}
              className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
            >
              <PlayIcon />
              Pasar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
