import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { LoadingState } from '@/components/ui'

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
        <div className="w-full max-w-sm">
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <footer className="pb-6 text-center text-xs text-subtle">
        Self-hosted. Your data stays on this server.
      </footer>
    </div>
  )
}
