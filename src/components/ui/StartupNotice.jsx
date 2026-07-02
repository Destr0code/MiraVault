import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandMark from './BrandMark'

function UpdateIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2Z" />
    </svg>
  )
}

export default function StartupNotice() {
  const navigate = useNavigate()
  const [modal, setModal] = useState(null)
  const [queue, setQueue] = useState([])
  const [showFullChangelog, setShowFullChangelog] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadStartupNotices() {
      const api = window.electronAPI
      if (!api) return

      const versionNotice = await api.appGetVersionNotice?.()
      const updateInfo = await api.appCheckForUpdates?.()
      const [sources, player] = await Promise.all([
        api.libraryGetSources?.().catch(() => []),
        api.playerGetConfig?.().catch(() => null)
      ])
      if (!alive) return

      const nextUpdate = updateInfo?.hasUpdate ? { type: 'update', ...updateInfo } : null
      const shouldShowOnboarding = !window.localStorage.getItem('mv-onboarding-dismissed') && (
        !Array.isArray(sources) || sources.length === 0 || !player?.playerPath
      )
      const onboarding = shouldShowOnboarding ? {
        type: 'onboarding',
        title: 'Deja MiraVault listo en dos minutos',
        highlights: [
          'Añade tu carpeta de biblioteca para que aparezcan tus series y peliculas.',
          'Configura VLC o deja que Windows use tu reproductor por defecto.',
          'Si usas IPTV, importa una lista M3U/M3U8 desde su apartado.'
        ]
      } : null
      const pending = [nextUpdate, onboarding].filter(Boolean)

      if (versionNotice?.show) {
        setModal({ type: 'version', ...versionNotice })
        setQueue(pending)
      } else if (nextUpdate) {
        setModal(nextUpdate)
        setQueue(onboarding ? [onboarding] : [])
      } else if (onboarding) {
        setModal(onboarding)
      }
    }

    loadStartupNotices().catch(() => {})

    return () => {
      alive = false
    }
  }, [])

  if (!modal) return null

  const isUpdate = modal.type === 'update'
  const isOnboarding = modal.type === 'onboarding'
  const title = isUpdate ? 'Hay una version nueva de MiraVault' : modal.title
  const subtitle = isUpdate
    ? `Tienes ${modal.currentVersion} y esta disponible ${modal.latestVersion}.`
    : isOnboarding ? 'Primeros pasos recomendados.' : 'Primer arranque de esta version.'
  const items = isUpdate
    ? (modal.body || '').split('\n').filter((line) => /^[-*]\s+/.test(line)).slice(0, 5).map((line) => line.replace(/^[-*]\s+/, ''))
    : modal.highlights || []

  async function close() {
    if (modal.type === 'version') {
      await window.electronAPI?.appMarkVersionNoticeSeen?.(modal.version)
    }
    if (modal.type === 'onboarding') {
      window.localStorage.setItem('mv-onboarding-dismissed', '1')
    }

    if (queue.length) {
      const [next, ...rest] = queue
      setModal(next)
      setQueue(rest)
      setShowFullChangelog(false)
      return
    }

    setModal(null)
    setShowFullChangelog(false)
  }

  async function openDownload() {
    await window.electronAPI?.openExternal?.(modal.assetUrl || modal.url)
    close()
  }

  async function dismissUpdate() {
    await window.electronAPI?.appDismissUpdateVersion?.(modal.latestVersion)
    close()
  }

  function goTo(path) {
    close()
    navigate(path)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-md">
      <div className="w-full max-w-[620px] overflow-hidden rounded-[28px] border border-[color:var(--border)] bg-[color:var(--bg-secondary)] shadow-[0_32px_110px_rgba(0,0,0,0.55)]">
        <div className="relative border-b border-[color:var(--border)] bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent)_34%,transparent),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent)] p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/20">
              {isUpdate ? <UpdateIcon /> : <BrandMark className="h-9 w-9" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.28em] text-[color:var(--accent)]">
                {isUpdate ? 'Actualizacion disponible' : isOnboarding ? 'Primeros pasos' : 'Version instalada'}
              </p>
              <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">{title}</h2>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-white/10 px-3 py-1 text-sm text-[color:var(--text-secondary)] hover:bg-white/10 hover:text-[color:var(--text-primary)]"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {items.length ? (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item} className="flex gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/70 p-3 text-sm text-[color:var(--text-secondary)]">
                  <span className="mt-0.5 text-[color:var(--accent)]"><SparkIcon /></span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/70 p-4 text-sm text-[color:var(--text-secondary)]">
              La nueva release ya esta publicada en GitHub. Puedes descargarla cuando quieras.
            </p>
          )}

          {!isUpdate && modal.extra ? (
            <p className="rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 p-4 text-sm text-[color:var(--text-secondary)]">
              {modal.extra}
            </p>
          ) : null}

          {!isUpdate && !isOnboarding && modal.raw ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowFullChangelog((value) => !value)}
                className="text-sm font-medium text-[color:var(--accent)] hover:underline"
              >
                {showFullChangelog ? 'Ocultar changelog completo' : 'Ver changelog completo'}
              </button>
              {showFullChangelog ? (
                <pre className="max-h-56 overflow-auto rounded-2xl border border-[color:var(--border)] bg-black/25 p-4 text-xs leading-5 text-[color:var(--text-secondary)]">
                  {modal.raw}
                </pre>
              ) : null}
            </div>
          ) : null}

          {isOnboarding ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <button type="button" onClick={() => goTo('/folders')} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/70 p-4 text-left text-sm text-[color:var(--text-primary)] hover:border-[color:var(--accent)]">
                Añadir biblioteca
              </button>
              <button type="button" onClick={() => goTo('/settings')} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/70 p-4 text-left text-sm text-[color:var(--text-primary)] hover:border-[color:var(--accent)]">
                Configurar reproductor
              </button>
              <button type="button" onClick={() => goTo('/iptv')} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/70 p-4 text-left text-sm text-[color:var(--text-primary)] hover:border-[color:var(--accent)]">
                Añadir IPTV
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            {isUpdate ? (
              <button
                type="button"
                onClick={dismissUpdate}
                className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)]"
              >
                No avisar de esta version
              </button>
            ) : null}
            <button
              type="button"
              onClick={close}
              className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]"
            >
              {isUpdate ? 'Ahora no' : 'Entendido'}
            </button>
            {isUpdate ? (
              <button
                type="button"
                onClick={openDownload}
                className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Descargar instalador
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
