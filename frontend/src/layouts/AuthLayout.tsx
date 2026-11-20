import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { LoadingState } from '@/components/ui'

export function AuthLayout() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 animate-float rounded-full bg-lemon opacity-10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-fg opacity-5 blur-3xl" />
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
        <div className="animate-fade-up glass relative w-full max-w-sm rounded-2xl border border-border p-6 shadow-xl shadow-primary/5 sm:p-8">
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
