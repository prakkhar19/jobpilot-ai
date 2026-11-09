import { Menu as MenuIcon } from 'lucide-react'
import { Suspense, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '@/components/layout/Logo'
import { NotificationsBell } from '@/components/layout/NotificationsBell'
import { Sidebar, SidebarNav } from '@/components/layout/Sidebar'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { UserMenu } from '@/components/layout/UserMenu'
import { Badge, Button, Drawer, LoadingState } from '@/components/ui'
import { useAuth } from '@/context/auth'

export function AppLayout() {
  const { user, status } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  if (user && !user.onboarding_completed) return <Navigate to="/onboarding" replace />

  return (
    <div className="flex h-full min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Sidebar />
      <Drawer open={navOpen} onOpenChange={setNavOpen} title="Navigation" side="left" hideHeader>
        <div className="flex h-14 items-center border-b border-border px-5">
          <Logo />
        </div>
        <SidebarNav onNavigate={() => setNavOpen(false)} />
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <MenuIcon className="h-5 w-5" aria-hidden="true" />
          </Button>
          <span className="lg:hidden">
            <Logo />
          </span>
          {status?.demo_mode && (
            <Badge tone="warning" className="hidden sm:inline-flex" title="This server runs in demo mode with fictional jobs.">
              Demo mode
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <NotificationsBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          <Suspense key={location.pathname} fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
