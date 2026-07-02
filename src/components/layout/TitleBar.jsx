import BrandMark from '@/components/ui/BrandMark'

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 12h12" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m7 7 10 10" />
      <path d="m17 7-10 10" />
    </svg>
  )
}

function WindowButton({ onClick, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex h-full w-[46px] items-center justify-center text-[color:var(--text-secondary)] transition-colors',
        danger
          ? 'hover:bg-[#e05555] hover:text-white'
          : 'hover:bg-[rgba(255,255,255,0.08)] hover:text-[color:var(--text-primary)]'
      ].join(' ')}
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {children}
    </button>
  )
}

export default function TitleBar() {
  return (
    <header
      className="flex h-[38px] items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-3"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-center gap-2 text-[color:var(--text-primary)]">
        <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-[color:var(--accent-muted)]">
          <BrandMark className="h-5 w-5 object-contain text-[color:var(--accent)]" alt="" />
        </div>
        <span className="text-sm font-medium">MiraVault</span>
      </div>

      <div className="flex h-full items-stretch">
        <WindowButton onClick={() => window.electronAPI?.minimize?.()}>
          <MinimizeIcon />
        </WindowButton>
        <WindowButton onClick={() => window.electronAPI?.maximize?.()}>
          <MaximizeIcon />
        </WindowButton>
        <WindowButton danger onClick={() => window.electronAPI?.close?.()}>
          <CloseIcon />
        </WindowButton>
      </div>
    </header>
  )
}
