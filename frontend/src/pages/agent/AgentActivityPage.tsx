import { useQuery } from '@tanstack/react-query'
import { Pause, Play, RotateCw, Square } from 'lucide-react'
import { useState } from 'react'
import { ConfigSummary } from '@/components/agent/ConfigSummary'
import { TaskStats } from '@/components/agent/TaskStats'
import { TaskStateBadge } from '@/components/shared/StatusBadge'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Select,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { POLL_INTERVAL_MS } from '@/hooks/useTaskPolling'
import { agentService } from '@/services/agent'
import { cn } from '@/utils/cn'
import { isTaskActive } from '@/utils/constants'
import { formatDate, formatRelative, humanize } from '@/utils/format'

const LEVELS = ['', 'info', 'warning', 'error']

function levelTone(level: string) {
  if (level === 'error') return 'danger' as const
  if (level === 'warning') return 'warning' as const
  return 'info' as const
}

function duration(start: string | null, end: string | null): string {
  if (!start) return '—'
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  if (Number.isNaN(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function AgentActivityPage() {
  const [taskFilter, setTaskFilter] = useState('')
  const [level, setLevel] = useState('')

  const config = useQuery({ queryKey: ['agent', 'config'], queryFn: agentService.config })
  const tasks = useQuery({
    queryKey: ['agent', 'tasks', 'list'],
    queryFn: () => agentService.tasks(30),
    refetchInterval: (q) => (q.state.data?.some((t) => isTaskActive(t.state)) ? POLL_INTERVAL_MS : 30_000),
  })
  const anyActive = !!tasks.data?.some((t) => isTaskActive(t.state))
  const logs = useQuery({
    queryKey: ['agent', 'logs', { taskFilter, level }],
    queryFn: () => agentService.logs({ task_id: taskFilter || undefined, level: level || undefined, limit: 300 }),
    refetchInterval: anyActive ? POLL_INTERVAL_MS : false,
  })

  const run = useMutationToast({
    mutationFn: () => agentService.run(),
    success: 'Agent run started',
    error: 'Could not start the agent',
    invalidate: [['agent', 'tasks']],
  })
  const pause = useMutationToast({
    mutationFn: () => agentService.pause(),
    success: 'Agent paused — running tasks will be cancelled',
    error: 'Could not pause the agent',
    invalidate: [['agent']],
  })
  const resume = useMutationToast({
    mutationFn: () => agentService.resume(),
    success: 'Agent resumed',
    error: 'Could not resume the agent',
    invalidate: [['agent']],
  })
  const cancel = useMutationToast({
    mutationFn: (id: string) => agentService.cancel(id),
    success: 'Cancellation requested',
    error: 'Could not cancel the task',
    invalidate: [['agent', 'tasks']],
  })

  const paused = config.data?.paused

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent Activity"
        description="The agent discovers jobs, analyzes and matches them, and prepares documents and applications according to your settings."
        actions={
          <>
            {config.data &&
              (paused ? (
                <Button variant="outline" onClick={() => resume.mutate()} loading={resume.isPending}>
                  {!resume.isPending && <Play className="h-4 w-4" aria-hidden="true" />} Resume
                </Button>
              ) : (
                <Button variant="outline" onClick={() => pause.mutate()} loading={pause.isPending}>
                  {!pause.isPending && <Pause className="h-4 w-4" aria-hidden="true" />} Pause
                </Button>
              ))}
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={anyActive}>
              {!run.isPending && <RotateCw className="h-4 w-4" aria-hidden="true" />} {anyActive ? 'Run in progress' : 'Run now'}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ConfigSummary config={config.data} loading={config.isPending} error={config.error} onRetry={() => void config.refetch()} />
        </div>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Task history"
            description={anyActive ? 'Live — refreshing every 2 seconds.' : 'Most recent 30 runs.'}
          />
          <CardBody className="p-0">
            {tasks.isPending ? (
              <LoadingState />
            ) : tasks.isError ? (
              <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
            ) : tasks.data.length === 0 ? (
              <EmptyState title="No runs yet" description="Click “Run now” to start the agent." />
            ) : (
              <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto" aria-live="polite">
                {tasks.data.map((t) => (
                  <li key={t.id} className={cn('px-5 py-3', taskFilter === t.id && 'bg-primary-soft/40')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <TaskStateBadge state={t.state} />
                      <span className="text-sm font-medium text-fg">{humanize(t.kind)}</span>
                      <span className="text-xs text-subtle">
                        {humanize(t.trigger)} · {formatRelative(t.created_at)} · {duration(t.started_at, t.finished_at)}
                        {t.attempt > 1 ? ` · attempt ${t.attempt}` : ''}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-pressed={taskFilter === t.id}
                          onClick={() => setTaskFilter(taskFilter === t.id ? '' : t.id)}
                        >
                          {taskFilter === t.id ? 'All logs' : 'View logs'}
                        </Button>
                        {isTaskActive(t.state) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger"
                            onClick={() => cancel.mutate(t.id)}
                            disabled={t.cancel_requested || (cancel.isPending && cancel.variables === t.id)}
                          >
                            <Square className="h-3.5 w-3.5" aria-hidden="true" /> {t.cancel_requested ? 'Cancelling…' : 'Cancel'}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      <TaskStats stats={t.stats} />
                    </div>
                    {t.error && <p className="mt-1.5 text-xs text-danger">{t.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Logs"
          description="Step-by-step record of what the agent did."
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Task" className="w-56">
                <Select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
                  <option value="">All tasks</option>
                  {tasks.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {formatDate(t.created_at, true)} — {t.state}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Level" className="w-32">
                <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l ? humanize(l) : 'All levels'}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          }
        />
        <CardBody className="p-0">
          {logs.isPending ? (
            <LoadingState />
          ) : logs.isError ? (
            <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
          ) : logs.data.length === 0 ? (
            <EmptyState title="No log entries" description={taskFilter || level ? 'Try clearing the filters.' : 'Logs appear once the agent runs.'} />
          ) : (
            <ol className="max-h-[32rem] divide-y divide-border overflow-y-auto font-mono text-xs">
              {logs.data.map((l) => (
                <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-5 py-2">
                  <time dateTime={l.created_at} className="w-36 shrink-0 text-subtle">
                    {formatDate(l.created_at, true)}
                  </time>
                  <Badge tone={levelTone(l.level)} className="w-16 justify-center font-sans">
                    {l.level}
                  </Badge>
                  <span className="w-28 shrink-0 truncate text-subtle" title={l.step}>
                    {l.step}
                  </span>
                  <span className="min-w-0 flex-1 font-sans text-sm break-words text-fg">{l.message}</span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
