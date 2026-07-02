import { useEffect, useMemo, useState } from 'react'
import { useThemeStore } from '@/store/themeStore'
import { useToast } from '@/components/ui/Toast'
import { themes } from '@/config/themes'
import BrandMark from '@/components/ui/BrandMark'

function ThemeCard({ theme, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-[22px] border p-4 text-left transition',
        active
          ? 'border-[color:var(--accent)] bg-[color:var(--accent-muted)]'
          : 'border-[color:var(--border)] bg-[color:var(--bg-card)]/45 hover:bg-[color:var(--bg-hover)]'
      ].join(' ')}
    >
      <div
        className="h-24 rounded-[18px]"
        style={{ background: `linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]} 48%, ${theme.colors[2]})` }}
      />
      <div className="mt-4 flex items-center justify-between">
        <div>
          <p className="text-lg font-medium text-[color:var(--text-primary)]">{theme.name}</p>
          <p className="text-sm text-[color:var(--text-secondary)]">Tema visual</p>
        </div>
        <div className="flex gap-2">
          {theme.colors.map((color) => (
            <span key={color} className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
          ))}
        </div>
      </div>
    </button>
  )
}

export default function Settings() {
  const { theme, setTheme } = useThemeStore()
  const [playerConfig, setPlayerConfig] = useState({ playerPath: '', playerName: '' })
  const [libraryStats, setLibraryStats] = useState({ total: 0, episodes: 0, totalSize: 0 })
  const { show } = useToast()

  useEffect(() => {
    let mounted = true

    const loadConfigs = async () => {
      const [player, stats] = await Promise.all([
        window.electronAPI?.playerGetConfig?.(),
        window.electronAPI?.libraryGetStats?.()
      ])

      if (mounted) {
        const loadedPlayer = player || { playerPath: '', playerName: '' }
        const playerFileName = String(loadedPlayer.playerPath || '').split('\\').pop()?.toLowerCase() || ''
        setPlayerConfig(playerFileName && playerFileName !== 'vlc.exe' ? { playerPath: '', playerName: '' } : loadedPlayer)
        setLibraryStats(stats || { total: 0, episodes: 0, totalSize: 0 })
      }
    }

    loadConfigs()
    return () => {
      mounted = false
    }
  }, [])

  const activeTheme = useMemo(() => themes.find((entry) => entry.id === theme), [theme])

  function detectPlayerName(filePath) {
    const fileName = String(filePath || '').split('\\').pop()?.toLowerCase() || ''
    if (fileName === 'vlc.exe') return 'VLC'
    if (fileName === 'mpc-hc64.exe') return 'MPC-HC'
    if (fileName === 'potplayermini64.exe') return 'PotPlayer'
    return fileName.replace(/\.exe$/i, '') || ''
  }

  async function handleSelectPlayer() {
    const filePath = await window.electronAPI?.playerSelectExe?.()
    if (!filePath) return
    setPlayerConfig({ playerPath: filePath, playerName: detectPlayerName(filePath) })
  }

  async function handleSavePlayer() {
    await window.electronAPI?.playerSaveConfig?.(playerConfig)
    show('Configuracion de reproductor guardada', 'success')
  }

  async function handleUseSystemDefault() {
    const cfg = { playerPath: '', playerName: '' }
    setPlayerConfig(cfg)
    await window.electronAPI?.playerSaveConfig?.(cfg)
    show('Se usara la app por defecto del sistema', 'info')
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.32em] text-[color:var(--text-muted)]">Preferencias</p>
        <div>
          <h1 className="text-4xl font-semibold text-[color:var(--text-primary)]">Ajustes</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--text-secondary)]">
            Personaliza la apariencia, el reproductor y la biblioteca local.
          </p>
        </div>
      </header>

      <section className="space-y-4 rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        <div>
          <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Apariencia</h2>

        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">

        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {themes.map((entry) => (
            <ThemeCard key={entry.id} theme={entry} active={theme === entry.id} onClick={() => setTheme(entry.id)} />
          ))}
        </div>
      </section>

      <section className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Reproductor de video</h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
          MiraVault usa VLC como reproductor externo preferido para MKV, audio multicanal, subtitulos y pantalla completa.
          Instala VLC en Windows o selecciona manualmente la ruta del ejecutable.
        </p>
        <div className="mt-4 space-y-4">
          <div className="rounded-[20px] border border-[color:var(--border)] bg-black/10 p-4">
            {playerConfig.playerPath ? (
              <div>
                <p className="text-lg font-medium text-[#84d49c]">{playerConfig.playerName || 'Reproductor configurado'}</p>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{playerConfig.playerPath}</p>
              </div>
            ) : (
              <p className="text-sm text-[color:var(--text-muted)]">Usando VLC instalado si esta disponible</p>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
            <input
              readOnly
              value={playerConfig.playerPath}
              className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm text-[color:var(--text-primary)]"
              placeholder="Ruta del ejecutable"
            />
            <button
              type="button"
              onClick={handleSelectPlayer}
              className="rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-hover)]"
            >
              Examinar
            </button>
          </div>

          <input
            value={playerConfig.playerName}
            onChange={(event) => setPlayerConfig((current) => ({ ...current, playerName: event.target.value }))}
            className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
            placeholder="Nombre del reproductor"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSavePlayer}
              className="rounded-xl bg-[color:var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:brightness-110"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={handleUseSystemDefault}
              className="rounded-xl border border-[color:var(--border)] px-5 py-3 text-sm text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-hover)]"
            >
              Usar app por defecto
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Biblioteca local</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-[20px] border border-[color:var(--border)] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Titulos</p>
            <p className="mt-3 text-lg font-medium text-[color:var(--text-primary)]">{libraryStats.total}</p>
          </div>
          <div className="rounded-[20px] border border-[color:var(--border)] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Episodios</p>
            <p className="mt-3 text-lg font-medium text-[color:var(--text-primary)]">{libraryStats.episodes}</p>
          </div>
          <div className="rounded-[20px] border border-[color:var(--border)] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Modo</p>
            <p className="mt-3 text-sm leading-6 text-[color:var(--text-secondary)]">
              MiraVault organiza archivos locales, guarda progreso de visionado y no gestiona descargas.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/45 p-5">
        <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Acerca de</h2>
        <div className="mt-4 flex items-center gap-4 rounded-[22px] border border-[color:var(--border)] bg-black/10 p-5">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[20px] bg-[color:var(--accent-muted)]">
            <BrandMark className="h-12 w-12 object-contain text-[color:var(--accent)]" />
          </div>
          <div>
            <p className="text-2xl font-semibold text-[color:var(--text-primary)]">MiraVault v0.4.2</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)]">
              Organizador de biblioteca local para peliculas, series y libros con deteccion automatica de temporadas,
              episodios, calidad, idioma, caratulas, metadatos y progreso de visionado.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
