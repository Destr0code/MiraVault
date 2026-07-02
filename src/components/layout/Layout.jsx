import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import Toast from '@/components/ui/Toast'
import StartupNotice from '@/components/ui/StartupNotice'

export default function Layout() {
  const location = useLocation()
  const isPlayer = location.pathname === '/player' || location.pathname === '/iptv/player'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[color:var(--bg-primary)] text-[color:var(--text-primary)]">
      <TitleBar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isPlayer ? null : <Sidebar />}

        <main className={isPlayer ? 'min-w-0 flex-1 overflow-hidden bg-black' : 'min-w-0 flex-1 overflow-hidden bg-[linear-gradient(180deg,var(--bg-primary),var(--bg-secondary))]'}>
          {isPlayer ? (
            <Outlet />
          ) : (
            <div className="h-full overflow-y-auto p-6">
              <div className="min-h-full rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)]/40 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-sm">
                <Outlet />
              </div>
            </div>
          )}
        </main>
      </div>

      <Toast />
      <StartupNotice />
    </div>
  )
}
