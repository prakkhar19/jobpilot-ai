import { Badge } from '@/components/ui'
import { APPLICATION_STATUS_LABELS, statusTone, TASK_STATE_LABELS, taskTone } from '@/utils/constants'
import { humanize } from '@/utils/format'

export function ApplicationStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {APPLICATION_STATUS_LABELS[status] ?? humanize(status)}
    </Badge>
  )
}

export function TaskStateBadge({ state, className }: { state: string; className?: string }) {
  return (
    <Badge tone={taskTone(state)} className={className}>
      {TASK_STATE_LABELS[state] ?? humanize(state.toLowerCase())}
    </Badge>
  )
}
