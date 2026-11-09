import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { MarkSubmittedDialog, StatusDialog } from '@/components/applications/ActionDialogs'
import { DocumentsCard } from '@/components/applications/DocumentsCard'
import { EventsTimeline } from '@/components/applications/EventsTimeline'
import { FormFieldsTable } from '@/components/applications/FormFieldsTable'
import {
  APPLICATION_EVENTS_KEY,
  APPLICATION_KEY,
  canDeleteApplication,
  isPreSubmission,
  needsPolling,
} from '@/components/applications/helpers'
import { MissingAnswersForm } from '@/components/applications/MissingAnswersForm'
import { NotesCard } from '@/components/applications/NotesCard'
import { ApplicationStatusBadge } from '@/components/shared/StatusBadge'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DefinitionList,
  EmptyState,
  ErrorState,
  LoadingState,
  ScoreBadge,
  buttonClasses,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { ApiError } from '@/services/api'
import { applicationService } from '@/services/applications'
import type { Application } from '@/types/api'
import { APPLICATION_STATUS_LABELS, POST_SUBMISSION, SOURCE_KIND_LABELS } from '@/utils/constants'
import { formatDate, humanize } from '@/utils/format'

const ANSWERABLE = new Set(['needs_input', 'awaiting_approval', 'ready_to_submit'])
const FILLABLE = new Set(['awaiting_approval', 'ready_to_submit', 'needs_input'])

export default function ApplicationDetailPage() {
  const { appId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [markOpen, setMarkOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  const query = useQuery({
    queryKey: APPLICATION_KEY(appId),
    queryFn: () => applicationService.get(appId),
    refetchInterval: (q) => (needsPolling(q.state.data) ? 2000 : false),
  })
  const statuses = useQuery({ queryKey: ['applications', 'statuses'], queryFn: applicationService.statuses, staleTime: 300_000 })
  const app = query.data

  // Announce the outcome when a background browser task (submit / assisted fill) finishes.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (!app) return
    const busy = needsPolling(app)
    if (wasBusy.current && !busy) {
      void qc.invalidateQueries({ queryKey: APPLICATION_EVENTS_KEY(app.id) })
      void qc.invalidateQueries({ queryKey: ['applications', 'list'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      if (app.last_error) toast.error('Browser task finished with a problem', { description: app.last_error })
      else if (POST_SUBMISSION.has(app.status)) toast.success('Application submitted', { description: app.confirmation_text || undefined })
      else toast.success('Browser task finished')
    }
    wasBusy.current = busy
  }, [app, qc])

  const apply = (data: Application) => {
    qc.setQueryData(APPLICATION_KEY(appId), data)
    void qc.invalidateQueries({ queryKey: APPLICATION_EVENTS_KEY(appId) })
    void qc.invalidateQueries({ queryKey: ['applications', 'list'] })
    void qc.invalidateQueries({ queryKey: ['analytics'] })
  }

  const answers = useMutationToast({
    mutationFn: (v: { answers: Record<string, string>; save: boolean }) => applicationService.answers(appId, v.answers, v.save),
    success: 'Answers saved',
    error: 'Could not save answers',
    onSuccess: apply,
  })
  const approve = useMutationToast({
    mutationFn: () => applicationService.approve(appId),
    success: 'Application approved — ready to submit',
    error: 'Could not approve',
    onSuccess: apply,
  })
  const submit = useMutationToast({
    mutationFn: () => applicationService.submit(appId),
    success: 'Submission queued — this page updates when it finishes',
    error: 'Could not submit',
    onSuccess: (d) => {
      setConfirmSubmit(false)
      apply(d)
    },
  })
  const fill = useMutationToast({
    mutationFn: () => applicationService.assistedFill(appId),
    success: 'Opening the form to pre-fill it (it will not be submitted)…',
    error: 'Could not start assisted fill',
    onSuccess: apply,
  })
  const refresh = useMutationToast({
    mutationFn: () => applicationService.refresh(appId),
    success: 'Application re-prepared',
    error: 'Could not re-prepare',
    onSuccess: apply,
  })
  const mark = useMutationToast({
    mutationFn: (v: { note: string; date: string | null }) => applicationService.markSubmitted(appId, v.note, v.date),
    success: 'Marked as submitted',
    error: 'Could not mark as submitted',
    onSuccess: (d) => {
      setMarkOpen(false)
      apply(d)
    },
  })
  const setStatus = useMutationToast({
    mutationFn: (v: { status: string; note: string }) => applicationService.setStatus(appId, v.status, v.note),
    success: 'Status updated',
    error: 'Could not change status',
    onSuccess: (d) => {
      setStatusOpen(false)
      apply(d)
    },
  })
  const del = useMutationToast({
    mutationFn: () => applicationService.remove(appId),
    success: 'Application deleted',
    error: 'Could not delete',
    invalidate: [['applications', 'list'], ['analytics'], ['jobs']],
    onSuccess: () => navigate('/applications', { replace: true }),
  })

  if (query.isPending) return <LoadingState label="Loading application…" />
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404)
      return (
        <EmptyState
          title="Application not found"
          description="It may have been deleted."
          action={<Link to="/applications" className={buttonClasses('primary')}>Back to applications</Link>}
        />
      )
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  if (!app) return null

  const caps = app.provider_capabilities ?? {}
  const pre = isPreSubmission(app.status)
  const busy = needsPolling(app)
  const labels: Record<string, string> = {
    ...APPLICATION_STATUS_LABELS,
    ...Object.fromEntries((statuses.data?.statuses ?? []).map((s) => [s.key, s.label])),
  }
  const manual = statuses.data?.manual ?? []
  const showAnswers = app.missing_fields.length > 0 && ANSWERABLE.has(app.status) && !busy
  const initialAnswers = Object.fromEntries(Object.entries(app.answers ?? {}).map(([k, v]) => [k, v?.value ?? '']))

  return (
    <div className="space-y-6">
      <div>
        <Link to="/applications" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Applications
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{app.job_title || 'Application'}</h1>
            <p className="mt-1 text-sm text-subtle">
              {app.company}
              {app.source_kind && <> · {SOURCE_KIND_LABELS[app.source_kind] ?? humanize(app.source_kind)}</>}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ApplicationStatusBadge status={app.status} />
              <ScoreBadge score={app.match_score} />
              <Badge>Mode: {humanize(app.mode)}</Badge>
              {app.is_demo && <Badge tone="warning">Demo sandbox</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/jobs/${app.job_id}`} className={buttonClasses('outline')}>
              View job
            </Link>
            {app.job_url && (
              <a href={app.job_url} target="_blank" rel="noopener noreferrer" className={buttonClasses('outline')}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open application page
              </a>
            )}
          </div>
        </div>
      </div>

      {busy && (
        <Alert tone="info" title="Working on it…">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {app.status === 'submitting'
              ? 'Submitting your application in an isolated browser. This page refreshes automatically.'
              : 'A browser task is running for this application. This page refreshes automatically.'}
          </span>
        </Alert>
      )}
      {app.last_error && !busy && (
        <Alert tone="danger" title="Last attempt needs attention">
          {app.last_error}
        </Alert>
      )}
      {app.status === 'needs_input' && !busy && (
        <Alert tone="warning" title="Some required questions need your answer">
          The agent never guesses screening answers. Answer them below, then approve.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Next steps" description={stepHint(app, !!caps.automated_submit)} />
            <CardBody className="flex flex-wrap gap-2">
              {pre && (
                <Button
                  onClick={() => approve.mutate()}
                  loading={approve.isPending}
                  disabled={app.status !== 'awaiting_approval' || busy}
                  title={app.status !== 'awaiting_approval' ? 'Available when the application awaits approval' : undefined}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve
                </Button>
              )}
              {caps.automated_submit && pre && (
                <Button
                  onClick={() => setConfirmSubmit(true)}
                  disabled={app.status !== 'ready_to_submit' || busy}
                  title={app.status !== 'ready_to_submit' ? 'Approve the application first' : undefined}
                >
                  <Send className="h-4 w-4" aria-hidden="true" /> Submit
                </Button>
              )}
              {caps.assisted_fill && pre && (
                <Button
                  variant="outline"
                  onClick={() => fill.mutate()}
                  loading={fill.isPending}
                  disabled={!FILLABLE.has(app.status) || busy}
                >
                  <Wand2 className="h-4 w-4" aria-hidden="true" /> Assisted fill
                </Button>
              )}
              {pre && (
                <Button variant="outline" onClick={() => refresh.mutate()} loading={refresh.isPending} disabled={busy}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Re-prepare
                </Button>
              )}
              {pre && (
                <Button variant="outline" onClick={() => setMarkOpen(true)} disabled={busy}>
                  <ListChecks className="h-4 w-4" aria-hidden="true" /> Mark as submitted
                </Button>
              )}
              {manual.length > 0 && (
                <Button variant="outline" onClick={() => setStatusOpen(true)} disabled={busy}>
                  Change status
                </Button>
              )}
              {POST_SUBMISSION.has(app.status) && (
                <Link to={`/interviews?application=${app.id}`} className={buttonClasses('outline')}>
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Add interview
                </Link>
              )}
              {canDeleteApplication(app) && (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy} className="text-danger">
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                </Button>
              )}
            </CardBody>
          </Card>

          {showAnswers && (
            <Card>
              <CardHeader
                title="Answer required questions"
                description="These could not be filled from your profile, application facts or answer bank."
              />
              <CardBody>
                <MissingAnswersForm
                  key={app.updated_at}
                  fields={app.missing_fields}
                  initial={initialAnswers}
                  submitting={answers.isPending}
                  onSubmit={(a, save) => answers.mutate({ answers: a, save })}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Application form"
              description="Fields read from the employer's form and the answers that will be used."
            />
            {app.form_fields.length ? (
              <FormFieldsTable fields={app.form_fields} answers={app.answers ?? {}} missing={app.missing_fields} />
            ) : (
              <EmptyState
                title="No form fields"
                description={
                  caps.inspection
                    ? 'The form has not been inspected yet. Re-prepare the application to read it.'
                    : 'This site does not support reading the form automatically. Open the application page to apply yourself.'
                }
              />
            )}
          </Card>

          {(app.preparation_screenshot || app.confirmation_screenshot || app.confirmation_text) && (
            <Card>
              <CardHeader title="Screenshots & confirmation" />
              <CardBody className="space-y-5">
                {app.confirmation_text && (
                  <div>
                    <h3 className="text-xs font-medium text-subtle">Confirmation</h3>
                    <p className="mt-1 text-sm break-words whitespace-pre-wrap text-fg">{app.confirmation_text}</p>
                  </div>
                )}
                {app.confirmation_screenshot && (
                  <figure>
                    <img
                      src={applicationService.screenshotUrl(app.id, 'confirmation', app.updated_at)}
                      alt="Confirmation page after submission"
                      className="w-full rounded-lg border border-border"
                      loading="lazy"
                    />
                    <figcaption className="mt-1 text-xs text-subtle">Confirmation page</figcaption>
                  </figure>
                )}
                {app.preparation_screenshot && (
                  <figure>
                    <img
                      src={applicationService.screenshotUrl(app.id, 'preparation', app.updated_at)}
                      alt="Pre-filled application form (not submitted)"
                      className="w-full rounded-lg border border-border"
                      loading="lazy"
                    />
                    <figcaption className="mt-1 text-xs text-subtle">
                      Pre-filled form from assisted fill — review it, then submit on the employer's site.
                    </figcaption>
                  </figure>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="History" description="Audit trail of every step taken on this application." />
            <CardBody>
              <EventsTimeline appId={app.id} poll={busy} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DefinitionList
                className="sm:grid-cols-1"
                items={[
                  ['Status', labels[app.status] ?? humanize(app.status)],
                  ['Created', formatDate(app.created_at, true)],
                  ['Approved', formatDate(app.approved_at, true)],
                  ['Submitted', app.submitted_at ? `${formatDate(app.submitted_at, true)}${app.submitted_by ? ` by ${app.submitted_by}` : ''}` : '—'],
                  ['Submit attempts', String(app.submit_attempts)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Application site" description={caps.label || humanize(app.provider)} />
            <CardBody className="space-y-2 text-sm">
              <Capability ok={!!caps.inspection} label="Reads the application form" />
              <Capability ok={!!caps.assisted_fill} label="Assisted fill (pre-fills, you submit)" />
              <Capability ok={!!caps.automated_submit} label="Automated submission" />
              {caps.note && <p className="pt-1 text-xs text-subtle">{caps.note}</p>}
            </CardBody>
          </Card>
          <DocumentsCard app={app} />
          <NotesCard key={`${app.id}-${app.notes}-${app.follow_up_date}`} app={app} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit this application?"
        description={`JobPilot AI will fill and submit the form for ${app.job_title} at ${app.company} with the approved answers and documents, then verify the confirmation.`}
        confirmLabel="Submit application"
        loading={submit.isPending}
        onConfirm={() => submit.mutate()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this application?"
        description="The application and its history will be removed. The job stays in your list."
        destructive
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
      {markOpen && (
        <MarkSubmittedDialog
          open={markOpen}
          onOpenChange={setMarkOpen}
          loading={mark.isPending}
          onConfirm={(note, date) => mark.mutate({ note, date })}
        />
      )}
      {statusOpen && (
        <StatusDialog
          open={statusOpen}
          onOpenChange={setStatusOpen}
          current={app.status}
          manual={manual}
          labels={labels}
          loading={setStatus.isPending}
          onConfirm={(status, note) => setStatus.mutate({ status, note })}
        />
      )}
    </div>
  )
}

function Capability({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? 'text-success' : 'text-subtle'} aria-hidden="true">
        {ok ? '✓' : '—'}
      </span>
      <span className={ok ? 'text-fg' : 'text-subtle'}>
        {label}
        <span className="sr-only">{ok ? ': supported' : ': not supported'}</span>
      </span>
    </div>
  )
}

function stepHint(app: Application, canSubmit: boolean): string {
  switch (app.status) {
    case 'needs_input':
      return 'Answer the required questions below, then approve.'
    case 'awaiting_approval':
      return 'Review the answers and documents, then approve.'
    case 'ready_to_submit':
      return canSubmit
        ? 'Approved. Submit automatically, or apply yourself and mark it as submitted.'
        : 'Approved. Open the application page, submit it yourself, then mark it as submitted.'
    case 'submitting':
      return 'Submission in progress…'
    case 'discovered':
    case 'shortlisted':
    case 'resume_generated':
      return 'Re-prepare to generate documents and read the application form.'
    default:
      return 'Track the employer’s response by updating the status.'
  }
}
