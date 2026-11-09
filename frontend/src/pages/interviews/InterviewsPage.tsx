import { useQuery } from '@tanstack/react-query'
import { CalendarClock, MapPin, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { InterviewDialog } from '@/components/applications/InterviewDialog'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { interviewService } from '@/services/applications'
import type { Interview, InterviewInput } from '@/types/api'
import { INTERVIEW_KIND_LABELS } from '@/utils/constants'
import { formatDate, humanize } from '@/utils/format'

const INVALIDATE = [['interviews'], ['applications'], ['analytics']]

export default function InterviewsPage() {
  const [params, setParams] = useSearchParams()
  const preselect = params.get('application') ?? ''
  const [dialog, setDialog] = useState<{ open: boolean; interview: Interview | null }>({ open: !!preselect, interview: null })
  const [toDelete, setToDelete] = useState<Interview | null>(null)

  const list = useQuery({ queryKey: ['interviews'], queryFn: () => interviewService.list() })

  const close = () => {
    setDialog({ open: false, interview: null })
    if (preselect) {
      const next = new URLSearchParams(params)
      next.delete('application')
      setParams(next, { replace: true })
    }
  }

  const save = useMutationToast({
    mutationFn: (body: InterviewInput) =>
      dialog.interview ? interviewService.update(dialog.interview.id, body) : interviewService.create(body),
    success: () => (dialog.interview ? 'Interview updated' : 'Interview added'),
    error: 'Could not save interview',
    invalidate: INVALIDATE,
    onSuccess: close,
  })
  const del = useMutationToast({
    mutationFn: (id: string) => interviewService.remove(id),
    success: 'Interview deleted',
    error: 'Could not delete interview',
    invalidate: INVALIDATE,
    onSuccess: () => setToDelete(null),
  })

  const items = list.data ?? []
  const { upcoming, past } = splitInterviews(items)

  return (
    <div>
      <PageHeader
        title="Interviews"
        description="Keep track of every conversation with employers. Adding an interview updates the application's status."
        actions={
          <Button onClick={() => setDialog({ open: true, interview: null })}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add interview
          </Button>
        }
      />
      {list.isPending ? (
        <LoadingState label="Loading interviews…" />
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
            title="No interviews yet"
            description="When an employer invites you to interview, add it here to keep your pipeline up to date."
            action={<Button onClick={() => setDialog({ open: true, interview: null })}>Add interview</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-8">
          <Section title="Upcoming" items={upcoming} onEdit={(i) => setDialog({ open: true, interview: i })} onDelete={setToDelete} />
          <Section title="Past & other" items={past} onEdit={(i) => setDialog({ open: true, interview: i })} onDelete={setToDelete} />
        </div>
      )}

      {dialog.open && (
        <InterviewDialog
          open={dialog.open}
          onOpenChange={(o) => !o && close()}
          interview={dialog.interview}
          defaultApplicationId={preselect}
          saving={save.isPending}
          onSave={(body) => save.mutate(body)}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this interview?"
        description={toDelete ? `${INTERVIEW_KIND_LABELS[toDelete.kind] ?? toDelete.kind} with ${toDelete.company}` : undefined}
        destructive
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  )
}

function splitInterviews(items: Interview[]): { upcoming: Interview[]; past: Interview[] } {
  const now = new Date().getTime()
  const upcoming = items.filter((i) => i.status === 'scheduled' && (!i.scheduled_at || new Date(i.scheduled_at).getTime() >= now))
  return { upcoming, past: items.filter((i) => !upcoming.includes(i)) }
}

function Section({
  title,
  items,
  onEdit,
  onDelete,
}: {
  title: string
  items: Interview[]
  onEdit: (i: Interview) => void
  onDelete: (i: Interview) => void
}) {
  if (!items.length) return null
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-sm font-semibold text-fg">
        {title} <span className="font-normal text-subtle">({items.length})</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((i) => (
          <li key={i.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{INTERVIEW_KIND_LABELS[i.kind] ?? humanize(i.kind)}</p>
                  <Link to={`/applications/${i.application_id}`} className="text-sm text-primary hover:underline">
                    {i.job_title || 'Application'} · {i.company}
                  </Link>
                </div>
                <Badge tone={i.status === 'completed' ? 'success' : i.status === 'cancelled' ? 'neutral' : 'primary'}>
                  {humanize(i.status)}
                </Badge>
              </div>
              <div className="mt-3 space-y-1 text-sm text-muted">
                <p className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-subtle" aria-hidden="true" />
                  {i.scheduled_at ? formatDate(i.scheduled_at, true) : 'Date not set'}
                </p>
                {i.location && (
                  <p className="flex items-center gap-2 break-all">
                    <MapPin className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" /> {i.location}
                  </p>
                )}
                {i.interviewers && (
                  <p className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-subtle" aria-hidden="true" /> {i.interviewers}
                  </p>
                )}
                {i.outcome && <p><span className="text-subtle">Outcome:</span> {i.outcome}</p>}
                {i.notes && <p className="whitespace-pre-wrap text-subtle">{i.notes}</p>}
              </div>
              <div className="mt-3 flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => onEdit(i)} aria-label={`Edit interview with ${i.company}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button variant="ghost" size="sm" className="text-danger" onClick={() => onDelete(i)} aria-label={`Delete interview with ${i.company}`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
