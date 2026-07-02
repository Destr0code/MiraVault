import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { useLocation, useNavigate } from 'react-router-dom'
import { useToast } from '@/components/ui/Toast'

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
      <path d="M8 6v12l10-6-10-6Z" />
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

function isExternalOnlyStream(url) {
  return /^(rtp|udp|rtsp):\/\//i.test(String(url || '').trim())
}

export default function IPTVPlayer() {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const hideTimerRef = useRef(null)
  const playbackIdRef = useRef(0)
  const activeUrlRef = useRef('')
  const navigate = useNavigate()
  const location = useLocation()
  const { show } = useToast()
  const channel = location.state?.channel || {}
  const channels = Array.isArray(location.state?.channels) ? location.state.channels : []
  const initialIndex = Math.max(0, Number(location.state?.index || 0))
  const [index, setIndex] = useState(initialIndex)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [error, setError] = useState('')
  const [debugInfo, setDebugInfo] = useState(null)
  const [status, setStatus] = useState('Conectando...')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [reloadNonce, setReloadNonce] = useState(0)

  const current = channels[index] || channel

  function cleanupPlayback(video) {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (video) {
      try {
        video.pause()
        video.removeAttribute('src')
        video.load()
      } catch {
        // Ignore cleanup races while switching channels.
      }
    }
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || !current?.url) return undefined

    let disposed = false
    const playbackId = playbackIdRef.current + 1
    playbackIdRef.current = playbackId
    activeUrlRef.current = current.url

    setError('')
    setDebugInfo(null)
    setStatus('Conectando...')
    setPlaying(false)
    cleanupPlayback(video)
    let bridgeStarted = false
    let bridgeTimeout = null

    const canNative = video.canPlayType('application/vnd.apple.mpegurl')
    const isHlsUrl = /\.m3u8(?:[?#].*)?$/i.test(current.url) || /m3u8/i.test(current.url)

    const safeSetError = (message) => {
      if (disposed || playbackIdRef.current !== playbackId) return
      setError(message)
      setStatus('No se pudo reproducir')
    }

    const startVideo = async () => {
      if (disposed || playbackIdRef.current !== playbackId) return
      try {
        setStatus('Iniciando reproduccion...')
        video.volume = volume
        video.muted = false
        await video.play()
        if (disposed || playbackIdRef.current !== playbackId) return
        setPlaying(true)
        setError('')
        setStatus('')
      } catch (playError) {
        safeSetError(playError?.message || 'Pulsa reproducir para iniciar este canal.')
      }
    }

    function loadHls(url) {
      setStatus('Cargando HLS...')
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: 12000,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 15000
      })
      hlsRef.current = hls
      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!disposed && playbackIdRef.current === playbackId) hls.loadSource(url)
      })
      hls.on(Hls.Events.MANIFEST_PARSED, startVideo)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data?.fatal) return
        const details = data?.details || ''
        if (details.includes('manifestLoadTimeOut')) {
          safeSetError('El canal HLS no responde a tiempo. Si es RTP/UDP/RTSP, el bridge no esta sirviendo la playlist local.')
          return
        }
        if (details.includes('fragLoadTimeOut') || details.includes('bufferStalledError')) {
          safeSetError('El canal se ha quedado sin buffer. Puede que el stream original sea inestable o que el bridge no genere segmentos suficientemente rapido.')
          return
        }
        safeSetError(details || 'No se pudo reproducir este stream HLS.')
      })
    }

    function loadDirect(url) {
      if (!isHlsUrl) {
        setError('Este canal no parece HLS/M3U8. Chromium puede no reproducir TS directo; si falla, abre VLC.')
      }
      video.addEventListener('loadedmetadata', startVideo, { once: true })
      video.addEventListener('canplay', startVideo, { once: true })
      video.addEventListener('error', () => safeSetError('El reproductor interno no pudo cargar este canal.'), { once: true })
      video.src = url
      video.load()
    }

    if (isExternalOnlyStream(current.url)) {
      setStatus('Preparando bridge IPTV...')
      bridgeTimeout = window.setTimeout(() => {
        safeSetError('No se pudo preparar el canal IPTV en 3 minutos. Prueba abrirlo en VLC o revisa la red multicast.')
      }, 180000)
      window.electronAPI?.iptvStartBridge?.(current.url).then((result) => {
        window.clearTimeout(bridgeTimeout)
        if (disposed || playbackIdRef.current !== playbackId) {
          return
        }
        setDebugInfo(result || null)
        if (!result?.ok || !result.hlsUrl) {
          safeSetError(result?.error || 'No se pudo preparar el bridge IPTV. Prueba abrirlo en VLC.')
          return
        }
        bridgeStarted = true
        setStatus(`Bridge IPTV listo (${result.engine || 'desconocido'})`)
        loadHls(result.hlsUrl)
      }).catch((bridgeError) => {
        window.clearTimeout(bridgeTimeout)
        safeSetError(bridgeError?.message || 'No se pudo preparar el bridge IPTV. Prueba abrirlo en VLC.')
      })
    } else if (isHlsUrl && Hls.isSupported() && !canNative) {
      loadHls(current.url)
    } else {
      loadDirect(current.url)
    }

    return () => {
      disposed = true
      if (bridgeTimeout) window.clearTimeout(bridgeTimeout)
      if (bridgeStarted) {
        const bridgeUrl = current.url
        window.setTimeout(() => {
          if (activeUrlRef.current !== bridgeUrl) window.electronAPI?.iptvStopBridge?.()
        }, 500)
      }
      if (playbackIdRef.current === playbackId) playbackIdRef.current += 1
      if (activeUrlRef.current === current.url) activeUrlRef.current = ''
      cleanupPlayback(video)
    }
  }, [current?.url, reloadNonce])

  useEffect(() => {
    showControls()
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  function showControls() {
    setControlsVisible(true)
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setControlsVisible(false)
    }, 2200)
  }

  async function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      try {
        await video.play()
        setPlaying(true)
        setError('')
      } catch (playError) {
        setError(playError?.message || 'No se pudo iniciar el canal.')
      }
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  async function openExternal() {
    const result = await window.electronAPI?.playerOpen?.(current.url, 0)
    show(result?.ok ? 'Abriendo en VLC' : result?.error || 'No se pudo abrir VLC', result?.ok ? 'success' : 'error')
  }

  function nextChannel(direction) {
    if (!channels.length) return
    showControls()
    setError('')
    setStatus('Conectando...')
    setIndex((value) => (value + direction + channels.length) % channels.length)
  }

  function toggleFullscreen() {
    const container = document.getElementById('iptv-player-frame')
    if (!document.fullscreenElement) {
      container?.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }

  if (!current?.url) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-white/70">
        No hay canal seleccionado.
      </div>
    )
  }

  return (
    <div className="h-full bg-black">
      <section
        id="iptv-player-frame"
        onMouseMove={showControls}
        onClick={showControls}
        className={[
          'relative flex h-full min-h-0 flex-col overflow-hidden bg-black',
          controlsVisible ? 'cursor-default' : 'cursor-none'
        ].join(' ')}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full bg-black object-contain"
          playsInline
          controls={false}
          onLoadStart={() => setStatus('Conectando...')}
          onWaiting={() => setStatus('Buffering...')}
          onCanPlay={() => {
            if (!error) setStatus('')
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false)
            setControlsVisible(true)
          }}
          onError={() => {
            if (activeUrlRef.current === current.url) {
              setError('El reproductor interno no pudo cargar este canal.')
              setStatus('No se pudo reproducir')
            }
          }}
        />

        <div
          className={[
            'pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/45 transition-opacity duration-300',
            controlsVisible || error ? 'opacity-100' : 'opacity-0'
          ].join(' ')}
        />

        <div
          className={[
            'absolute inset-x-0 top-0 z-20 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 p-5 transition-all duration-300',
            controlsVisible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'
          ].join(' ')}
        >
          <button type="button" onClick={() => navigate('/iptv')} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-4 py-2 text-sm text-white backdrop-blur hover:bg-white/10">
            <BackIcon />
            Volver
          </button>
          <div className="min-w-0 text-center">
            <p className="truncate text-xl font-semibold text-white drop-shadow">{current.name || 'IPTV'}</p>
            <p className="truncate text-xs uppercase tracking-[0.18em] text-white/55">{current.group || 'Sin grupo'} · {current.source || 'IPTV'}</p>
          </div>
          <button type="button" onClick={openExternal} className="rounded-xl border border-white/15 bg-black/35 px-4 py-2 text-sm text-white backdrop-blur hover:bg-white/10">
            Abrir VLC
          </button>
        </div>

        {error ? (
          <div className="absolute inset-x-6 top-24 z-30 rounded-2xl border border-[#f3cf63]/30 bg-black/75 p-4 text-sm text-[#f3cf63] backdrop-blur">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span className="min-w-0 whitespace-pre-wrap">
                {error}
                {debugInfo?.engine ? <span className="mt-2 block text-xs text-white/50">Bridge: {debugInfo.engine}</span> : null}
                {debugInfo?.outputDir ? <span className="mt-1 block break-all text-xs text-white/50">Temp: {debugInfo.outputDir}</span> : null}
                {debugInfo?.logPath ? <span className="mt-1 block break-all text-xs text-white/50">Log: {debugInfo.logPath}</span> : null}
              </span>
              <button type="button" onClick={openExternal} className="rounded-xl bg-[#f3cf63] px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
                Abrir en VLC
              </button>
            </div>
          </div>
        ) : null}

        {status && !error ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-2xl border border-white/10 bg-black/70 px-5 py-3 text-sm text-white/80 backdrop-blur">
              {status}
            </div>
          </div>
        ) : null}

        <div
          className={[
            'absolute inset-x-0 bottom-0 z-20 p-5 transition-all duration-300',
            controlsVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0 pointer-events-none'
          ].join(' ')}
        >
          <div className="rounded-[24px] border border-white/10 bg-[#07090f]/78 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => nextChannel(-1)} disabled={!channels.length} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-40">Anterior</button>
                <button type="button" onClick={togglePlay} className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--accent)] text-white hover:brightness-110">
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button type="button" onClick={() => nextChannel(1)} disabled={!channels.length} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-40">Siguiente</button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase tracking-[0.18em] text-white/45">Volumen</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setVolume(next)
                    if (videoRef.current) videoRef.current.volume = next
                  }}
                />
                <button type="button" onClick={() => setReloadNonce((value) => value + 1)} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10">
                  Recargar
                </button>
                <button type="button" onClick={toggleFullscreen} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10">
                  Pantalla completa
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
