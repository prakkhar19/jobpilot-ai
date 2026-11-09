import { useQuery } from '@tanstack/react-query'
import { Monitor } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { authService } from '@/services/auth'
import type { SessionInfo } from '@/types/api'
import { formatDate, formatRelative } from '@/utils/format'

const KEY = ['auth', 'sessions'] as const

function describeAgent(ua: string): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return [browser, os].filter(Boolean).join(' on ') || ua.slice(0, 60)
}

export function SessionsCard() {
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: KEY, queryFn: authService.sessions })
  const [revoking, setRevoking] = useState<SessionInfo | null>(null)
  const [revokeAll, setRevokeAll] = useState(false)
  const revoke = useMutationToast({
    mutationFn: (id: string) => authService.revokeSession(id),
    success: 'Session revoked',
    invalidate: [KEY],
    onSuccess: () => setRevoking(null),
  })
  const others = useMutationToast({
    mutationFn: () => authService.revokeOthers(),
    success: 'Signed out of all other sessions',
    invalidate: [KEY],
    onSuccess: () => setRevokeAll(false),
  })
  const otherCount = data?.filter((s) => !s.current).length ?? 0

  return (
    <Card>
      <CardHeader
        title="Active sessions"
        description="Devices currently signed in to your account."
        actions={
          <Button variant="outline" size="sm" disabled={!otherCount} onClick={() => setRevokeAll(true)}>
            Sign out other sessions
          </Button>
        }
      />
      <CardBody className="p-0">
        {isPending && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && data.length === 0 && <EmptyState title="No active sessions" />}
        {data && data.length > 0 && (
          <ul className="divide-y divide-border">
            {data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Monitor className="h-5 w-5 text-subtle" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {describeAgent(s.user_agent)} {s.current && <Badge tone="success">This device</Badge>}
                  </p>
                  <p className="text-xs text-subtle">
                    {s.ip_address || 'Unknown IP'} · Active {formatRelative(s.last_seen_at)} · Signed in {formatDate(s.created_at)} · Expires{' '}
                    {formatDate(s.expires_at)}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" onClick={() => setRevoking(s)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this session?"
        description={revoking ? `${describeAgent(revoking.user_agent)} (${revoking.ip_address || 'unknown IP'}) will be signed out.` : undefined}
        confirmLabel="Revoke"
        destructive
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
      <ConfirmDialog
        open={revokeAll}
        onOpenChange={setRevokeAll}
        title="Sign out all other sessions?"
        description={`${otherCount} other session(s) will be signed out. This device stays signed in.`}
        confirmLabel="Sign out others"
        destructive
        loading={others.isPending}
        onConfirm={() => others.mutate()}
      />
    </Card>
  )
}
