import { useQuery } from '@tanstack/react-query'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { applicationService } from '@/services/applications'
import { APPLICATION_STATUS_LABELS } from '@/utils/constants'
import { formatDate, humanize } from '@/utils/format'
import { APPLICATION_EVENTS_KEY } from './helpers'

export function EventsTimeline({ appId, poll }: { appId: string; poll: boolean }) {
  const q = useQuery({
    queryKey: APPLICATION_EVENTS_KEY(appId),
    queryFn: () => applicationService.events(appId),
    refetchInterval: poll ? 2000 : false,
  })
  if (q.isPending) return <LoadingState label="Loading history…" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState title="No events yet" />
  const events = [...q.data].reverse()
  return (
    <ol className="relative space-y-4 border-l border-border pl-5" aria-label="Application history">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-1.5 -left-[1.6rem] h-2.5 w-2.5 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium text-fg">{humanize(e.event_type)}</span>
            {e.to_status && e.to_status !== e.from_status && (
              <span className="text-xs text-subtle">
                {APPLICATION_STATUS_LABELS[e.from_status] ?? e.from_status} → {APPLICATION_STATUS_LABELS[e.to_status] ?? e.to_status}
              </span>
            )}
          </div>
          {e.message && <p className="mt-0.5 text-sm break-words text-muted">{e.message}</p>}
          <p className="mt-0.5 text-xs text-subtle">
            {formatDate(e.created_at, true)} · by {e.actor}
          </p>
        </li>
      ))}
    </ol>
  )
}
