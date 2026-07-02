import { useEffect, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import EmptyState from '@/components/ui/EmptyState'

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
    </svg>
  )
}

export default function Folders() {
  const [sources, setSources] = useState([])
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [seriesRoot, setSeriesRoot] = useState('')
  const [organizePreview, setOrganizePreview] = useState(null)
  const { show } = useToast()

  async function loadSources() {
    const data = await window.electronAPI?.libraryGetSources?.()
    setSources(Array.isArray(data) ? data : [])
  }

  async function loadSeriesRoot() {
    const config = await window.electronAPI?.qbittorrentGetConfig?.()
    setSeriesRoot(config?.seriesDownloadPath || '')
  }

  useEffect(() => {
    loadSources()
    loadSeriesRoot()
  }, [])

  async function runAction(action) {
    setBusy(true)
    try {
      await action()
      await loadSources()
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  function withTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(message)), ms)
      })
    ])
  }

  async function handleAddFolder() {
    const selected = await window.electronAPI?.selectFolder?.()
    if (!selected) return

    await runAction(async () => {
      await window.electronAPI?.libraryImportPaths?.([selected])
      show('Carpeta anadida a la biblioteca', 'success')
    })
  }

  async function handleRemove(sourcePath) {
    await runAction(async () => {
      await window.electronAPI?.libraryRemoveSource?.(sourcePath)
      show('Carpeta eliminada', 'info')
    })
  }

  async function handleRescan() {
    await runAction(async () => {
      await window.electronAPI?.libraryRescan?.()
      show('Carpetas reescaneadas', 'info')
    })
  }

  async function handleSelectSeriesRoot() {
    const selected = await window.electronAPI?.selectFolder?.()
    if (!selected) return
    setSeriesRoot(selected)
    setOrganizePreview(null)
    const config = await window.electronAPI?.qbittorrentGetConfig?.()
    await window.electronAPI?.qbittorrentSetConfig?.({ ...(config || {}), seriesDownloadPath: selected })
  }

  async function handlePreviewSeries() {
    if (!seriesRoot.trim()) {
      show('Elige primero la carpeta que quieres ordenar', 'error')
      return
    }

    setBusyLabel('Analizando carpeta...')
    try {
      await runAction(async () => {
        await new Promise((resolve) => window.requestAnimationFrame(resolve))
        const result = await withTimeout(
          window.electronAPI?.libraryPreviewOrganizeSeriesFolder?.(seriesRoot),
          70000,
          'El analisis esta tardando demasiado. Si es una unidad externa, revisa que este activa y prueba con una subcarpeta mas concreta.'
        )
        if (!result?.ok) {
          show(result?.error || 'No se pudo analizar la carpeta de series', 'error')
          return
        }
        setOrganizePreview(result)
        const warningText = result.warnings ? `, ${result.warnings} avisos` : ''
        show(`Analisis listo: ${result.moved} por mover, ${result.cleaned || 0} a limpiar${warningText}, ${result.unrecognized} sin detectar`, 'info')
      })
    } catch (error) {
      show(error.message || 'No se pudo analizar la carpeta de series', 'error')
    }
  }

  async function handleOrganizeSeries() {
    if (!seriesRoot.trim()) {
      show('Elige primero la carpeta que quieres ordenar', 'error')
      return
    }
    if (!organizePreview && !window.confirm('No has hecho vista previa. Quieres ordenar igualmente?')) return

    setBusyLabel('Ordenando carpeta...')
    try {
      await runAction(async () => {
        await new Promise((resolve) => window.requestAnimationFrame(resolve))
        const result = await withTimeout(
          window.electronAPI?.libraryOrganizeSeriesFolder?.(seriesRoot),
          180000,
          'La ordenacion esta tardando demasiado. Si la carpeta esta en una unidad externa, espera a que termine de responder y prueba de nuevo.'
        )
        if (!result?.ok) {
          show(result?.error || 'No se pudo ordenar la carpeta de series', 'error')
          return
        }
        setOrganizePreview(result)
        const warningText = result.warnings ? `, ${result.warnings} avisos` : ''
        show(`Series ordenadas: ${result.moved} movidos, ${result.cleaned || 0} limpiados${warningText}, ${result.unrecognized} sin detectar`, 'success')
        window.electronAPI?.libraryRescan?.().then(loadSources).catch(() => {})
      })
    } catch (error) {
      show(error.message || 'No se pudo ordenar la carpeta de series', 'error')
    }
  }

  function formatSize(bytes) {
    const value = Number(bytes || 0)
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
    return `${Math.round(value / 1024)} KB`
  }

  function fileName(value) {
    return String(value || '').split(/[\\/]/).pop()
  }

  const visiblePreviewItems = (organizePreview?.items || []).filter((item) => (
    item.action !== 'skipped' && item.action !== 'cleaned'
  ))

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.32em] text-[color:var(--text-muted)]">Biblioteca</p>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[color:var(--text-primary)]">Carpetas monitorizadas</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--text-secondary)]">
              Usa esta lista para conservar rutas fijas dentro de tu biblioteca. Cuando reescaneas, MiraVault
              recorre estas carpetas y vuelve a detectar peliculas, series, episodios y libros.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleAddFolder}
              disabled={busy}
              className="rounded-xl bg-[color:var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
            >
              Anadir carpeta
            </button>
            <button
              type="button"
              onClick={handleRescan}
              disabled={busy}
              className="rounded-xl border border-[color:var(--border)] px-5 py-3 text-sm text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-hover)] disabled:opacity-60"
            >
              Reescaneo manual
            </button>
          </div>
        </div>
      </header>

      <section className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Organizar series</h2>
            <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
              Elige manualmente la carpeta que quieres ordenar. MiraVault no usa una ruta por defecto para evitar mover archivos donde no toca.
            </p>
            <input
              value={seriesRoot}
              onChange={(event) => {
                setSeriesRoot(event.target.value)
                setOrganizePreview(null)
              }}
              placeholder="Selecciona una carpeta de series para ordenar"
              className="mt-4 w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSelectSeriesRoot}
              disabled={busy}
              className="rounded-xl border border-[color:var(--border)] px-5 py-3 text-sm text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-hover)] disabled:opacity-60"
            >
              Cambiar carpeta
            </button>
            <button
              type="button"
              onClick={handlePreviewSeries}
              disabled={busy || !seriesRoot.trim()}
              className="rounded-xl border border-[color:var(--accent)] px-5 py-3 text-sm text-[color:var(--accent)] transition hover:bg-[color:var(--accent-muted)] disabled:opacity-60"
            >
              {busy ? 'Analizando...' : 'Vista previa'}
            </button>
            <button
              type="button"
              onClick={handleOrganizeSeries}
              disabled={busy || !seriesRoot.trim()}
              className="rounded-xl bg-[color:var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {busy ? 'Ordenando...' : 'Ordenar ahora'}
            </button>
          </div>
        </div>

        {busyLabel ? (
          <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)]/60 px-4 py-3 text-sm text-[color:var(--text-secondary)]">
            {busyLabel}
          </div>
        ) : null}

        {organizePreview ? (
          <div className="mt-5 space-y-4 rounded-[22px] border border-[color:var(--border)] bg-black/10 p-4">
            <div className="grid gap-3 md:grid-cols-7">
              {[
                ['Escaneados', organizePreview.scanned],
                [organizePreview.applied ? 'Movidos' : 'Por mover', organizePreview.moved],
                [organizePreview.applied ? 'Limpiados' : 'A limpiar', organizePreview.cleaned],
                ['Ya correctos', organizePreview.skipped],
                ['Duplicados', organizePreview.duplicates],
                ['Avisos', organizePreview.warnings],
                ['Sin detectar', organizePreview.unrecognized]
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)]/60 p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-muted)]">{label}</p>
                  <p className="mt-2 text-xl font-semibold text-[color:var(--text-primary)]">{value || 0}</p>
                </div>
              ))}
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {visiblePreviewItems.slice(0, 80).map((item, index) => (
                <div
                  key={`${item.from}-${item.to || index}`}
                  className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)]/45 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={[
                      'rounded-full px-2 py-1',
                      item.action === 'move' || item.action === 'moved' ? 'bg-[color:var(--accent-muted)] text-[color:var(--accent)]' : '',
                      item.action === 'cleanup' || item.action === 'cleaned' ? 'bg-[#f3cf63]/15 text-[#f3cf63]' : '',
                      item.action === 'warning' ? 'bg-[#f3cf63]/15 text-[#f3cf63]' : '',
                      item.action === 'skipped' ? 'bg-[#4caf6e]/15 text-[#84d49c]' : '',
                      item.action === 'incomplete' || item.action === 'missing' ? 'bg-[#f3cf63]/15 text-[#f3cf63]' : '',
                      item.action === 'unrecognized' || item.action === 'error' ? 'bg-[#e05555]/15 text-[#e05555]' : ''
                    ].join(' ')}>
                      {item.action === 'move' ? 'Mover' : item.action === 'moved' ? 'Movido' : item.action === 'cleanup' ? 'Eliminar' : item.action === 'cleaned' ? 'Limpiado' : item.action === 'warning' ? 'Aviso' : item.action === 'incomplete' ? 'Incompleto' : item.action === 'missing' ? 'Ya no existe' : item.action === 'skipped' ? 'OK' : item.action === 'unrecognized' ? 'Sin detectar' : item.action}
                    </span>
                    {item.duplicateRole ? (
                      <span className={['rounded-full px-2 py-1', item.duplicateRole === 'best' ? 'bg-[#4caf6e]/15 text-[#84d49c]' : 'bg-[#f3cf63]/15 text-[#f3cf63]'].join(' ')}>
                        {item.duplicateRole === 'best' ? 'Mejor version' : 'Duplicado'}
                      </span>
                    ) : null}
                    {item.quality ? <span className="text-[color:var(--text-muted)]">{item.quality}</span> : null}
                    {item.language ? <span className="text-[color:var(--text-muted)]">{item.language}</span> : null}
                    {item.codec ? <span className="text-[color:var(--text-muted)]">{item.codec}</span> : null}
                    {item.size ? <span className="text-[color:var(--text-muted)]">{formatSize(item.size)}</span> : null}
                  </div>
                  <p className="mt-2 truncate text-sm text-[color:var(--text-primary)]">{fileName(item.from)}</p>
                  {item.to ? (
                    <p className="mt-1 truncate text-xs text-[color:var(--text-muted)]">→ {item.to}</p>
                  ) : null}
                  {item.error ? <p className="mt-1 text-xs text-[#e05555]">{item.error}</p> : null}
                  {item.warning ? <p className="mt-1 text-xs text-[#f3cf63]">{item.warning}</p> : null}
                </div>
              ))}
            </div>
            {visiblePreviewItems.length > 80 ? (
              <p className="text-xs text-[color:var(--text-muted)]">Mostrando 80 de {visiblePreviewItems.length} cambios.</p>
            ) : null}
            {organizePreview.omittedItems > 0 ? (
              <p className="text-xs text-[color:var(--text-muted)]">
                Hay {organizePreview.omittedItems} cambios adicionales ocultos para mantener la app fluida.
              </p>
            ) : null}
            {organizePreview.truncated ? (
              <p className="rounded-2xl border border-[#f3cf63]/30 bg-[#f3cf63]/10 p-3 text-xs text-[#f3cf63]">
                {organizePreview.timedOut
                  ? 'El analisis se ha cortado por tiempo para evitar bloqueos. Usa una carpeta mas concreta o divide el ordenado por tandas.'
                  : 'La carpeta es muy grande y el analisis se ha limitado para evitar bloqueos. Ordena por tandas si faltan archivos.'}
              </p>
            ) : null}
            {visiblePreviewItems.length === 0 ? (
              <p className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)]/45 p-4 text-sm text-[color:var(--text-secondary)]">
                No hay cambios pendientes. Todo lo util ya esta ordenado.
              </p>
            ) : null}

          </div>
        ) : null}
      </section>

      <section className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        {sources.length > 0 ? (
          <div className="space-y-3">
            {sources.map((source) => (
              <div
                key={source.path}
                className="flex flex-col gap-4 rounded-[20px] border border-[color:var(--border)] bg-black/10 p-4 xl:flex-row xl:items-center xl:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--accent-muted)] text-[color:var(--accent)]">
                    <FolderIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[color:var(--text-muted)]">Fuente</p>
                    <p className="truncate text-lg font-medium text-[color:var(--text-primary)]">{source.path}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => window.electronAPI?.openFolder?.(source.path)}
                    className="rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-hover)]"
                  >
                    Abrir
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(source.path)}
                    className="rounded-xl border border-[#7a2f36] px-4 py-3 text-sm text-[#ffccd2] transition hover:bg-[#45171d]/60"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FolderIcon />}
            title="No hay carpetas monitorizadas"
            description="Puedes trabajar solo importando archivos sueltos, o guardar aqui carpetas para futuros reescaneos."
            action={(
              <button
                type="button"
                onClick={handleAddFolder}
                className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white"
              >
                Anadir primera carpeta
              </button>
            )}
          />
        )}
      </section>
    </div>
  )
}
