import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { agentService } from '@/services/agent'
import { isTaskActive } from '@/utils/constants'
import type { AgentTask } from '@/types/api'

export const POLL_INTERVAL_MS = 2000

/** Polls GET /api/agent/tasks/{id} every 2 s while the task is in an active state. */
export function useTaskPolling(taskId: string | null | undefined, onDone?: (task: AgentTask) => void) {
  const qc = useQueryClient()
  const doneRef = useRef<string | null>(null)
  const query = useQuery({
    queryKey: ['agent', 'task', taskId],
    queryFn: () => agentService.task(taskId as string),
    enabled: !!taskId,
    refetchInterval: (q) => (q.state.data && !isTaskActive(q.state.data.state) ? false : POLL_INTERVAL_MS),
  })
  const task = query.data
  useEffect(() => {
    if (task && !isTaskActive(task.state) && doneRef.current !== task.id) {
      doneRef.current = task.id
      void qc.invalidateQueries({ queryKey: ['agent', 'tasks'] })
      onDone?.(task)
    }
  }, [task, qc, onDone])
  return { task, active: !!task && isTaskActive(task.state), query }
}
