import { useEffect, useMemo, useState } from 'react'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14" />
    </svg>
  )
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${Math.round(value)} B`
}

function formatSpeed(value) {
  return `${formatBytes(value)}/s`
}

function formatEta(seconds) {
  const value = Number(seconds || 0)
  if (!Number.isFinite(value) || value <= 0 || value >= 8640000) return 'Sin ETA'
  const h = Math.floor(value / 3600)
  const m = Math.floor((value % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function stateLabel(state) {
  const labels = {
    downloading: 'Descargando',
    uploading: 'Compartiendo',
    stalledDL: 'Sin peers',
    stalledUP: 'Compartiendo',
    pausedDL: 'Pausado',
    pausedUP: 'Pausado',
    checkingDL: 'Verificando',
    checkingUP: 'Verificando',
    error: 'Error',
    missingFiles: 'Faltan archivos',
    queuedDL: 'En cola',
    queuedUP: 'En cola',
    metadata: 'Buscando metadata',
    paused: 'Pausado',
    completed: 'Completado'
  }
  return labels[state] || state || 'Desconocido'
}

function isPaused(state) {
  return state === 'pausedDL' || state === 'pausedUP'
}

function isComplete(torrent) {
  return Number(torrent.progress || 0) >= 1 || torrent.state === 'uploading' || torrent.state === 'stalledUP' || torrent.state === 'pausedUP'
}

const sortOptions = [
  { value: 'downloaded', label: 'Descargado' },
  { value: 'eta', label: 'Tiempo' },
  { value: 'progress', label: 'Porcentaje' }
]

function getDownloadedBytes(torrent) {
  const completed = Number(torrent.completed || 0)
  if (completed > 0) return completed
  return Math.round(Number(torrent.size || 0) * Number(torrent.progress || 0))
}

function getSortableEta(torrent) {
  const eta = Number(torrent.eta)
  if (!Number.isFinite(eta) || eta <= 0 || eta >= 8640000) return Number.MAX_SAFE_INTEGER
  return eta
}

function TorrentRow({ torrent, onAction }) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(torrent.progress || 0) * 100)))
  const complete = isComplete(torrent)

  return (
    <article className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/55 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--accent-muted)] text-[color:var(--accent)]">
              <DownloadIcon />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[color:var(--text-primary)]">{torrent.name}</h3>
              <p className="mt-1 truncate text-xs text-[color:var(--text-muted)]">{torrent.save_path || 'Ruta no disponible'}</p>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20">
            <div
              className={['h-full rounded-full', complete ? 'bg-[#4caf6e]' : torrent.state === 'error' ? 'bg-[#e05555]' : 'bg-[color:var(--accent)]'].join(' ')}
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text-secondary)]">
            <span>{progress}%</span>
            <span>{stateLabel(torrent.state)}</span>
            <span>{formatSpeed(torrent.dlspeed)}</span>
            <span>{formatEta(torrent.eta)}</span>
            <span>{formatBytes(torrent.size)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isPaused(torrent.state) ? (
            <button type="button" onClick={() => onAction('resume', torrent)} className="rounded-xl bg-[color:var(--accent)] px-3 py-2 text-xs font-medium text-white">
              Reanudar
            </button>
          ) : (
            <button type="button" onClick={() => onAction('pause', torrent)} className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]">
              Pausar
            </button>
          )}
          <button type="button" onClick={() => onAction('open', torrent)} className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]">
            Abrir
          </button>
          {complete ? (
            <button type="button" onClick={() => onAction('import', torrent)} className="rounded-xl border border-[#1f8b58]/40 px-3 py-2 text-xs text-[#84d49c] hover:bg-[#1f8b58]/15">
              Importar
            </button>
          ) : null}
          <button type="button" onClick={() => onAction('delete', torrent)} className="rounded-xl border border-[#e05555]/35 px-3 py-2 text-xs text-[#e05555] hover:bg-[#e05555]/10">
            Eliminar
          </button>
        </div>
      </div>
    </article>
  )
}

export default function Downloads() {
  const { show } = useToast()
  const [activeEngine, setActiveEngine] = useState('webtorrent')
  const [config, setConfig] = useState({
    url: 'http://localhost:8080',
    username: 'admin',
    password: 'admin123',
    seriesDownloadPath: ''
  })
  const [webConfig, setWebConfig] = useState({ downloadPath: '' })
  const [engine, setEngine] = useState({ engine: 'webtorrent', ok: false })
  const [status, setStatus] = useState({ ok: false, checking: true, error: '' })
  const [torrents, setTorrents] = useState([])
  const [transfer, setTransfer] = useState(null)
  const [magnetOrUrl, setMagnetOrUrl] = useState('')
  const [torrentFiles, setTorrentFiles] = useState([])
  const [savePath, setSavePath] = useState('')
  const [adding, setAdding] = useState(false)
  const [sortBy, setSortBy] = useState('progress')
  const [sortDirection, setSortDirection] = useState('desc')

  const stats = useMemo(() => {
    const active = torrents.filter((torrent) => !isComplete(torrent) && !isPaused(torrent.state)).length
    const completed = torrents.filter(isComplete).length
    return {
      active,
      completed,
      total: torrents.length,
      speed: transfer?.dl_info_speed || torrents.reduce((sum, torrent) => sum + Number(torrent.dlspeed || 0), 0)
    }
  }, [torrents, transfer])

  const sortedTorrents = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1
    return [...torrents].sort((a, b) => {
      let left = 0
      let right = 0

      if (sortBy === 'downloaded') {
        left = getDownloadedBytes(a)
        right = getDownloadedBytes(b)
      } else if (sortBy === 'eta') {
        left = getSortableEta(a)
        right = getSortableEta(b)
      } else {
        left = Number(a.progress || 0)
        right = Number(b.progress || 0)
      }

      if (left === right) return String(a.name || '').localeCompare(String(b.name || ''))
      return (left - right) * direction
    })
  }, [torrents, sortBy, sortDirection])

  function handleSort(nextSortBy) {
    if (nextSortBy === sortBy) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
      return
    }

    setSortBy(nextSortBy)
    setSortDirection(nextSortBy === 'eta' ? 'asc' : 'desc')
  }

  async function loadConfig() {
    const data = await window.electronAPI?.torrentGetConfig?.()
    if (data?.engine) setActiveEngine(data.engine)
    if (data?.qbittorrent) setConfig(data.qbittorrent)
    if (data?.webtorrent) setWebConfig(data.webtorrent)
    const engineStatus = await window.electronAPI?.torrentEngineStatus?.()
    if (engineStatus) setEngine(engineStatus)
  }

  async function testConnection(showToast = false) {
    setStatus((current) => ({ ...current, checking: true }))
    const result = await window.electronAPI?.torrentPing?.()
    setStatus({ ok: Boolean(result?.ok), checking: false, error: result?.error || '', version: result?.version || '' })
    if (showToast) show(result?.ok ? 'Motor torrent disponible' : result?.error || 'Sin conexion', result?.ok ? 'success' : 'error')
    return result
  }

  async function loadTorrents() {
    const [items, transferInfo] = await Promise.all([
      window.electronAPI?.torrentList?.('all'),
      window.electronAPI?.torrentTransferInfo?.()
    ])
    setTorrents(Array.isArray(items) ? items : [])
    setTransfer(transferInfo || null)
  }

  useEffect(() => {
    loadConfig()
    testConnection(false).then((result) => {
      if (result?.ok) loadTorrents()
    })

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        testConnection(false).then((result) => {
          if (result?.ok) loadTorrents()
        })
      }
    }, 2500)

    return () => window.clearInterval(interval)
  }, [])

  async function saveConfig() {
    const next = await window.electronAPI?.torrentSetConfig?.({
      engine: activeEngine,
      qbittorrent: config,
      webtorrent: webConfig
    })
    if (next?.engine) setActiveEngine(next.engine)
    if (next?.qbittorrent) setConfig(next.qbittorrent)
    if (next?.webtorrent) setWebConfig(next.webtorrent)
    const engineStatus = await window.electronAPI?.torrentEngineStatus?.()
    if (engineStatus) setEngine(engineStatus)
    await testConnection(true)
  }

  async function chooseEngine(nextEngine) {
    const next = await window.electronAPI?.torrentSetConfig?.({
      engine: nextEngine,
      qbittorrent: config,
      webtorrent: webConfig
    })
    if (next?.engine) setActiveEngine(next.engine)
    if (next?.qbittorrent) setConfig(next.qbittorrent)
    if (next?.webtorrent) setWebConfig(next.webtorrent)
    const engineStatus = await window.electronAPI?.torrentEngineStatus?.()
    if (engineStatus) setEngine(engineStatus)
    await testConnection(true)
    await loadTorrents()
  }

  async function selectFolder() {
    const selected = await window.electronAPI?.selectFolder?.()
    if (selected) setSavePath(selected)
  }

  async function selectSeriesFolder() {
    const selected = await window.electronAPI?.selectFolder?.()
    if (selected) setConfig((current) => ({ ...current, seriesDownloadPath: selected }))
  }

  async function selectTorrentFiles() {
    const selected = await window.electronAPI?.selectTorrentFiles?.()
    if (Array.isArray(selected) && selected.length > 0) {
      setTorrentFiles((current) => Array.from(new Set([...current, ...selected])))
    }
  }

  async function addTorrent() {
    setAdding(true)
    const result = await window.electronAPI?.torrentAdd?.({ magnetOrUrl, torrentFiles, savePath })
    setAdding(false)
    if (!result?.ok) {
      show(result?.error || 'No se pudo anadir el torrent', 'error')
      return
    }
    setMagnetOrUrl('')
    setTorrentFiles([])
    if (result.matched?.type === 'series-root') {
      show('Torrent enviado a la carpeta de series', 'success')
    } else if (result.matched) {
      show(`Torrent enviado a ${result.matched.title}`, 'success')
    } else if (result.savePath) {
      show('Torrent enviado a la carpeta seleccionada', 'success')
    } else {
      show(activeEngine === 'webtorrent' ? 'Torrent añadido a WebTorrent' : 'Torrent enviado a qBittorrent', 'success')
    }
    await loadTorrents()
  }

  async function handleAction(action, torrent) {
    if (action === 'pause') await window.electronAPI?.torrentPause?.(torrent.hash)
    if (action === 'resume') await window.electronAPI?.torrentResume?.(torrent.hash)
    if (action === 'open') {
      const result = await window.electronAPI?.torrentOpenContent?.(torrent)
      if (!result?.ok) show(result?.error || 'No se pudo abrir la carpeta', 'error')
    }
    if (action === 'import') {
      const result = await window.electronAPI?.torrentImportContent?.(torrent)
      show(result?.ok ? 'Contenido importado a la biblioteca' : result?.error || 'No se pudo importar', result?.ok ? 'success' : 'error')
    }
    if (action === 'delete') {
      const deleteFiles = window.confirm('Quieres borrar tambien los archivos descargados?')
      const result = await window.electronAPI?.torrentDelete?.({ hash: torrent.hash, deleteFiles })
      if (!result?.ok) show(result?.error || 'No se pudo eliminar', 'error')
    }
    await loadTorrents()
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-[color:var(--text-muted)]">Torrents</p>
          <h1 className="mt-2 text-4xl font-semibold text-[color:var(--text-primary)]">Descargas</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--text-secondary)]">
            Descarga con WebTorrent interno o conecta qBittorrent externo como modo avanzado.
          </p>
        </div>
        <div className={['rounded-full px-4 py-2 text-sm', status.ok ? 'bg-[#1f8b58]/20 text-[#84d49c]' : 'bg-[#e05555]/15 text-[#e05555]'].join(' ')}>
          {status.checking ? 'Comprobando...' : status.ok ? `Conectado ${status.version || ''}` : 'Sin conexion'}
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/55 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Velocidad</p>
          <p className="mt-3 text-xl font-semibold text-[color:var(--text-primary)]">{formatSpeed(stats.speed)}</p>
        </div>
        <div className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/55 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Activos</p>
          <p className="mt-3 text-xl font-semibold text-[color:var(--text-primary)]">{stats.active}</p>
        </div>
        <div className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/55 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Completados</p>
          <p className="mt-3 text-xl font-semibold text-[color:var(--text-primary)]">{stats.completed}</p>
        </div>
        <div className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/55 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Total</p>
          <p className="mt-3 text-xl font-semibold text-[color:var(--text-primary)]">{stats.total}</p>
        </div>
      </section>

      <section className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Motor torrent</h2>
            <p className="mt-1 text-sm text-[color:var(--text-secondary)]">Elige motor interno WebTorrent o qBittorrent externo.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => chooseEngine('webtorrent')}
              className={['rounded-xl px-4 py-2 text-sm', activeEngine === 'webtorrent' ? 'bg-[color:var(--accent)] text-white' : 'border border-[color:var(--border)] text-[color:var(--text-primary)]'].join(' ')}
            >
              WebTorrent
            </button>
            <button
              type="button"
              onClick={() => chooseEngine('qbittorrent')}
              className={['rounded-xl px-4 py-2 text-sm', activeEngine === 'qbittorrent' ? 'bg-[color:var(--accent)] text-white' : 'border border-[color:var(--border)] text-[color:var(--text-primary)]'].join(' ')}
            >
              qBittorrent
            </button>
          </div>
        </div>

        {activeEngine === 'qbittorrent' ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_160px_160px_auto_auto]">
            <input
              value={config.url}
              onChange={(event) => setConfig((current) => ({ ...current, url: event.target.value }))}
              className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]"
            />
            <input value={config.username} onChange={(event) => setConfig((current) => ({ ...current, username: event.target.value }))} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
            <input type="password" value={config.password} onChange={(event) => setConfig((current) => ({ ...current, password: event.target.value }))} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]" />
            <button type="button" onClick={saveConfig} className="rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-medium text-white">Guardar</button>
            <button type="button" onClick={() => testConnection(true)} className="rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]">Probar</button>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={webConfig.downloadPath || ''}
              onChange={(event) => setWebConfig((current) => ({ ...current, downloadPath: event.target.value }))}
              placeholder="Carpeta de descargas WebTorrent"
              className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]"
            />
            <button type="button" onClick={saveConfig} className="rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-medium text-white">Guardar</button>
          </div>
        )}
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <label className="sr-only" htmlFor="series-download-path">Carpeta raiz de series</label>
          <input
            id="series-download-path"
            value={config.seriesDownloadPath || ''}
            onChange={(event) => setConfig((current) => ({ ...current, seriesDownloadPath: event.target.value }))}
            placeholder="Carpeta raiz para episodios detectados"
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]"
          />
          <button type="button" onClick={selectSeriesFolder} className="rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]">Carpeta series</button>
        </div>
        <p className="mt-2 text-xs text-[color:var(--text-muted)]">
          Opcional: si eliges una carpeta, los torrents que parezcan episodios podran caer ahi cuando no se encuentre una serie existente.
        </p>
      </section>

      <section className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Anadir torrent</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectTorrentFiles}
            className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]"
          >
            Seleccionar .torrent
          </button>
          {torrentFiles.length > 0 ? (
            <button
              type="button"
              onClick={() => setTorrentFiles([])}
              className="rounded-xl border border-[#e05555]/35 px-4 py-2 text-sm text-[#e05555] hover:bg-[#e05555]/10"
            >
              Limpiar archivos
            </button>
          ) : null}
        </div>
        {torrentFiles.length > 0 ? (
          <div className="mt-3 space-y-2 rounded-2xl border border-[color:var(--border)] bg-black/10 p-3">
            {torrentFiles.map((filePath) => (
              <div key={filePath} className="flex items-center justify-between gap-3 text-xs text-[color:var(--text-secondary)]">
                <span className="min-w-0 truncate">{filePath}</span>
                <button
                  type="button"
                  onClick={() => setTorrentFiles((current) => current.filter((entry) => entry !== filePath))}
                  className="shrink-0 rounded-lg px-2 py-1 text-[#e05555] hover:bg-[#e05555]/10"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          value={magnetOrUrl}
          onChange={(event) => setMagnetOrUrl(event.target.value)}
          rows={4}
          placeholder="Pega aqui un magnet o URL .torrent. Tambien puedes seleccionar archivos .torrent arriba."
          className="mt-4 w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]"
        />
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            value={savePath}
            onChange={(event) => setSavePath(event.target.value)}
            placeholder="Ruta de descarga opcional. Si esta vacia, qBittorrent usara su ruta por defecto."
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]"
          />
          <button type="button" onClick={selectFolder} className="rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]">Carpeta</button>
          <button type="button" onClick={addTorrent} disabled={adding || (!magnetOrUrl.trim() && torrentFiles.length === 0)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--accent)] px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
            {adding ? <Spinner size="sm" /> : <DownloadIcon />}
            Descargar
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Cola</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Ordenar</span>
            {sortOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSort(option.value)}
                className={[
                  'rounded-xl px-3 py-2 text-xs transition',
                  sortBy === option.value
                    ? 'bg-[color:var(--accent)] text-white'
                    : 'border border-[color:var(--border)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]'
                ].join(' ')}
              >
                {option.label}{sortBy === option.value ? (sortDirection === 'asc' ? ' ASC' : ' DESC') : ''}
              </button>
            ))}
          </div>
        </div>
        {sortedTorrents.length > 0 ? (
          sortedTorrents.map((torrent) => <TorrentRow key={torrent.hash} torrent={torrent} onAction={handleAction} />)
        ) : (
          <EmptyState
            icon={<DownloadIcon />}
            title="No hay torrents en cola"
            description={status.ok ? 'Pega un magnet para empezar una descarga.' : status.error || 'qBittorrent no esta conectado.'}
          />
        )}
      </section>
    </div>
  )
}
