import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui'
import { applicationService } from '@/services/applications'
import type { Interview, InterviewInput, InterviewKind, InterviewStatus } from '@/types/api'
import { INTERVIEW_KIND_LABELS, POST_SUBMISSION } from '@/utils/constants'
import { fromDateTimeInput, toDateTimeInput } from '@/utils/format'

const SUBMITTED_STATUSES = [...POST_SUBMISSION].join(',')

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  interview?: Interview | null
  defaultApplicationId?: string
  onSave: (body: InterviewInput) => void
  saving?: boolean
}

export function InterviewDialog({ open, onOpenChange, interview, defaultApplicationId, onSave, saving }: Props) {
  const editing = !!interview
  const [form, setForm] = useState({
    application_id: interview?.application_id ?? defaultApplicationId ?? '',
    scheduled_at: toDateTimeInput(interview?.scheduled_at),
    kind: (interview?.kind ?? 'phone_screen') as InterviewKind,
    status: (interview?.status ?? 'scheduled') as InterviewStatus,
    location: interview?.location ?? '',
    interviewers: interview?.interviewers ?? '',
    outcome: interview?.outcome ?? '',
    notes: interview?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const apps = useQuery({
    queryKey: ['applications', 'list', 'submitted-for-interviews'],
    queryFn: () => applicationService.list({ status: SUBMITTED_STATUSES, page_size: 100 }),
    enabled: open,
  })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.application_id) {
      setError('Select the application this interview belongs to.')
      return
    }
    setError(null)
    onSave({ ...form, scheduled_at: fromDateTimeInput(form.scheduled_at) })
  }

  const noApps = apps.data && apps.data.items.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit interview' : 'Add interview'}
      description="Interviews can only be added to applications that have been submitted."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="interview-form" loading={saving} disabled={!!noApps && !editing}>
            {editing ? 'Save changes' : 'Add interview'}
          </Button>
        </>
      }
    >
      <form id="interview-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {noApps && !editing && (
          <Alert tone="info" className="sm:col-span-2">
            You have no submitted applications yet. Mark an application as submitted in{' '}
            <Link to="/applications" className="underline">Applications</Link> first.
          </Alert>
        )}
        <Field label="Application" required error={error} className="sm:col-span-2" hint={apps.isError ? 'Could not load applications.' : undefined}>
          <Select value={form.application_id} onChange={(e) => set('application_id', e.target.value)} disabled={editing || apps.isPending}>
            <option value="">{apps.isPending ? 'Loading…' : 'Select a submitted application…'}</option>
            {editing && interview && !apps.data?.items.some((a) => a.id === interview.application_id) && (
              <option value={interview.application_id}>
                {interview.job_title} — {interview.company}
              </option>
            )}
            {apps.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.job_title} — {a.company}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date & time">
          <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={form.kind} onChange={(e) => set('kind', e.target.value as InterviewKind)}>
            {Object.entries(INTERVIEW_KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as InterviewStatus)}>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Location or link">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Zoom, office address…" />
        </Field>
        <Field label="Interviewers" className="sm:col-span-2">
          <Input value={form.interviewers} onChange={(e) => set('interviewers', e.target.value)} />
        </Field>
        <Field label="Outcome" className="sm:col-span-2">
          <Input value={form.outcome} onChange={(e) => set('outcome', e.target.value)} placeholder="e.g. Moved to final round" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </form>
    </Dialog>
  )
}
