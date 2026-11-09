import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { TaskStateBadge } from '@/components/shared/StatusBadge'
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton } from '@/components/ui'
import { agentService, systemService } from '@/services/agent'
import type { HeartbeatCheck } from '@/types/api'
import { isTaskActive } from '@/utils/constants'
import { formatRelative } from '@/utils/format'

function Heartbeat({ name, check }: { name: string; check?: HeartbeatCheck }) {
  const status = check?.status ?? 'unknown'
  const tone = status === 'ok' ? 'success' : status === 'stale' ? 'warning' : 'neutral'
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-fg">{name}</span>
      <span className="flex items-center gap-2 text-xs text-subtle">
        {check?.last_seen_at ? `seen ${formatRelative(check.last_seen_at)}` : 'never seen'}
        <Badge tone={tone}>{status === 'ok' ? 'Healthy' : status === 'stale' ? 'Stale' : 'Unknown'}</Badge>
      </span>
    </div>
  )
}

export function AgentHealthCard() {
  const diag = useQuery({ queryKey: ['diagnostics'], queryFn: systemService.diagnostics, refetchInterval: 60_000 })
  const tasks = useQuery({
    queryKey: ['agent', 'tasks', 'latest'],
    queryFn: () => agentService.tasks(1),
    refetchInterval: (q) => (q.state.data?.[0] && isTaskActive(q.state.data[0].state) ? 2000 : 30_000),
  })
  const latest = tasks.data?.[0]
  return (
    <Card>
      <CardHeader title="Agent health" actions={<Link to="/agent" className="text-xs text-primary hover:underline">Agent activity</Link>} />
      <CardBody className="divide-y divide-border py-2">
        {diag.isPending ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : diag.isError ? (
          <ErrorState error={diag.error} title="Diagnostics unavailable" onRetry={() => void diag.refetch()} className="py-4" />
        ) : (
          <>
            <Heartbeat name="Background worker" check={diag.data.checks.worker} />
            <Heartbeat name="Scheduler" check={diag.data.checks.scheduler} />
          </>
        )}
        <div className="flex items-center justify-between gap-3 py-2">
          <span className="text-sm text-fg">Latest run</span>
          {tasks.isPending ? (
            <Skeleton className="h-5 w-24" />
          ) : tasks.isError ? (
            <span className="text-xs text-danger">Unavailable</span>
          ) : latest ? (
            <span className="flex items-center gap-2 text-xs text-subtle">
              {formatRelative(latest.created_at)}
              <TaskStateBadge state={latest.state} />
            </span>
          ) : (
            <span className="text-xs text-subtle">No runs yet</span>
          )}
        </div>
        {latest?.state === 'FAILED' && latest.error && <p className="py-2 text-xs text-danger">{latest.error}</p>}
      </CardBody>
    </Card>
  )
}
