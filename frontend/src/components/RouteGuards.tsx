import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/ui'
import { useAuth } from '@/context/auth'

function FullPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6">{children}</div>
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, error, refresh, status } = useAuth()
  const location = useLocation()
  if (loading)
    return (
      <FullPage>
        <LoadingState label="Loading JobPilot AI…" />
      </FullPage>
    )
  if (error && !status)
    return (
      <FullPage>
        <ErrorState error={error} title="Cannot reach the JobPilot AI server" onRetry={() => void refresh()} />
      </FullPage>
    )
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading)
    return (
      <FullPage>
        <LoadingState />
      </FullPage>
    )
  if (user) return <Navigate to={user.onboarding_completed ? '/' : '/onboarding'} replace />
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
