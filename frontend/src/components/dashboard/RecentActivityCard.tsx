import { useQuery } from '@tanstack/react-query'
import { Bell, Bot } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { agentService, notificationService } from '@/services/agent'
import { cn } from '@/utils/cn'
import { formatRelative } from '@/utils/format'

interface Item {
  id: string
  kind: 'log' | 'notification'
  title: string
  detail?: string
  at: string
  link?: string
  level?: string
}

export function RecentActivityCard() {
  const logs = useQuery({ queryKey: ['agent', 'logs', 'recent'], queryFn: () => agentService.logs({ limit: 10 }) })
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => notificationService.list({ limit: 20 }) })

  const loading = logs.isPending || notes.isPending
  const error = logs.error ?? notes.error
  const items: Item[] = [
    ...(logs.data ?? []).map<Item>((l) => ({ id: `l-${l.id}`, kind: 'log', title: l.message, detail: l.step, at: l.created_at, level: l.level })),
    ...(notes.data?.items ?? []).slice(0, 10).map<Item>((n) => ({
      id: `n-${n.id}`,
      kind: 'notification',
      title: n.title,
      detail: n.body,
      at: n.created_at,
      link: n.link,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12)

  return (
    <Card>
      <CardHeader title="Recent activity" description="Agent steps and notifications." />
      <CardBody className="p-0">
        {loading ? (
          <LoadingState />
        ) : error && !items.length ? (
          <ErrorState error={error} onRetry={() => { void logs.refetch(); void notes.refetch() }} />
        ) : items.length === 0 ? (
          <EmptyState title="No activity yet" description="Run discovery to see the agent at work." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const Icon = it.kind === 'log' ? Bot : Bell
              const body = (
                <>
                  <Icon
                    className={cn('mt-0.5 h-4 w-4 shrink-0', it.level === 'error' ? 'text-danger' : it.level === 'warning' ? 'text-warning' : 'text-subtle')}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-fg">{it.title}</span>
                    {it.detail && <span className="line-clamp-1 block text-xs text-subtle">{it.detail}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-subtle">{formatRelative(it.at)}</span>
                </>
              )
              return (
                <li key={it.id}>
                  {it.link && it.link.startsWith('/') ? (
                    <Link to={it.link} className="flex gap-3 px-5 py-3 hover:bg-surface-2">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-5 py-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
