import { useQueryClient } from '@tanstack/react-query'
import { Play, Square } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert, Button } from '@/components/ui'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { agentService } from '@/services/agent'
import { errorMessage } from '@/services/api'
import { jobService } from '@/services/jobs'
import type { AgentTask } from '@/types/api'
import { TASK_STATE_LABELS } from '@/utils/constants'
import { TaskStateBadge } from './StatusBadge'

function summarize(task: AgentTask): string {
  const s = task.stats as Record<string, unknown>
  const d = (s.discovery ?? {}) as Record<string, unknown>
  const parts: string[] = []
  if (typeof d.new_jobs === 'number') parts.push(`${d.new_jobs} new job(s)`)
  if (typeof d.fetched === 'number') parts.push(`${d.fetched} fetched`)
  if (typeof s.matched === 'number') parts.push(`${s.matched} matched`)
  if (typeof s.qualified === 'number') parts.push(`${s.qualified} above your threshold`)
  return parts.join(' · ')
}

/**
 * "Run discovery" button with live progress (POST /api/jobs/discover → poll the task every 2 s).
 * Invalidates job queries when the run finishes.
 */
export function DiscoveryRunner({
  label = 'Run discovery',
  onFinished,
  size = 'md',
}: {
  label?: string
  onFinished?: (task: AgentTask) => void
  size?: 'sm' | 'md'
}) {
  const qc = useQueryClient()
  const [taskId, setTaskId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const handleDone = useCallback(
    (task: AgentTask) => {
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      void qc.invalidateQueries({ queryKey: ['analytics'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      if (task.state === 'COMPLETED') toast.success('Discovery finished', { description: summarize(task) || undefined })
      else if (task.state === 'FAILED') toast.error('Discovery failed', { description: task.error || undefined })
      else toast.message(`Discovery ${TASK_STATE_LABELS[task.state]?.toLowerCase() ?? task.state}`)
      onFinished?.(task)
    },
    [qc, onFinished],
  )
  const { task, active } = useTaskPolling(taskId, handleDone)

  const start = async () => {
    setStarting(true)
    try {
      const res = await jobService.discover()
      setTaskId(res.task_id)
      toast.message('Discovery started', { description: 'Fetching jobs from your enabled sources…' })
    } catch (err) {
      toast.error('Could not start discovery', { description: errorMessage(err) })
    } finally {
      setStarting(false)
    }
  }

  const cancel = async () => {
    if (!taskId) return
    setCancelling(true)
    try {
      await agentService.cancel(taskId)
      toast.message('Cancellation requested')
    } catch (err) {
      toast.error('Could not cancel', { description: errorMessage(err) })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={start} loading={starting} disabled={active} size={size}>
        {!starting && <Play className="h-4 w-4" aria-hidden="true" />}
        {active ? 'Discovery running…' : label}
      </Button>
      {task && (
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          <TaskStateBadge state={task.state} />
          {active && (
            <Button variant="ghost" size="sm" onClick={cancel} loading={cancelling} disabled={task.cancel_requested}>
              <Square className="h-3.5 w-3.5" aria-hidden="true" /> {task.cancel_requested ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
          {!active && summarize(task) && <span className="text-subtle">{summarize(task)}</span>}
        </div>
      )}
      {task?.state === 'FAILED' && task.error && (
        <Alert tone="danger" className="w-full" action={<Link className="text-sm underline" to="/agent">View logs</Link>}>
          {task.error}
        </Alert>
      )}
    </div>
  )
}
