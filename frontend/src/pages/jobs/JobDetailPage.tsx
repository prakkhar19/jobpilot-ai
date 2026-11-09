import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Send,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MatchBreakdown } from '@/components/jobs/MatchBreakdown'
import { PrepareApplicationDialog } from '@/components/jobs/PrepareApplicationDialog'
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
  buttonClasses,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { ApiError } from '@/services/api'
import { applicationService } from '@/services/applications'
import { coverLetterService, resumeService } from '@/services/documents'
import { jobService } from '@/services/jobs'
import type { JobDetail } from '@/types/api'
import { SOURCE_KIND_LABELS, WORKPLACE_LABELS } from '@/utils/constants'
import { formatDate, formatRelative, formatSalary, humanize } from '@/utils/format'

export default function JobDetailPage() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const key = ['jobs', 'detail', jobId]
  const job = useQuery({ queryKey: key, queryFn: () => jobService.get(jobId) })
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [prepareOpen, setPrepareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const setDetail = (d: JobDetail) => {
    qc.setQueryData(key, d)
    void qc.invalidateQueries({ queryKey: ['jobs', 'list'] })
  }
  const refetch = () => void qc.invalidateQueries({ queryKey: ['jobs'] })

  const save = useMutationToast({
    mutationFn: (saved: boolean) => (saved ? jobService.unsave(jobId) : jobService.save(jobId)),
    success: (_d, saved) => (saved ? 'Removed from saved jobs' : 'Job saved'),
    error: 'Could not update saved jobs',
    onSuccess: refetch,
  })
  const hide = useMutationToast({
    mutationFn: (hidden: boolean) => jobService.hide(jobId, hidden),
    success: (_d, hidden) => (hidden ? 'Job hidden from your lists' : 'Job restored'),
    error: 'Could not update the job',
    onSuccess: refetch,
  })
  const verify = useMutationToast({
    mutationFn: () => jobService.verify(jobId),
    success: (d) => (d.status === 'expired' ? 'This posting is no longer open' : 'The posting is still open'),
    error: 'Verification failed',
    onSuccess: setDetail,
  })
  const rematch = useMutationToast({
    mutationFn: () => jobService.rematch(jobId),
    success: 'Match recomputed',
    error: 'Matching failed',
    onSuccess: setDetail,
  })
  const explain = useMutationToast({
    mutationFn: () => jobService.aiSummary(jobId),
    error: 'AI explanation unavailable',
    onSuccess: (d) => setAiSummary(d.summary),
  })
  const track = useMutationToast({
    mutationFn: () => applicationService.track(jobId),
    success: 'Added to your applications tracker',
    error: 'Could not track this job',
    invalidate: [['applications']],
    onSuccess: refetch,
  })
  const genResume = useMutationToast({
    mutationFn: () => resumeService.generate({ job_id: jobId }),
    success: (rv) => `Tailored resume v${rv.version_number} generated`,
    error: 'Resume generation failed',
    invalidate: [['resumes']],
    onSuccess: (rv) => navigate(`/resumes/${rv.id}`),
  })
  const genLetter = useMutationToast({
    mutationFn: () => coverLetterService.generate(jobId),
    success: 'Cover letter generated',
    error: 'Cover letter generation failed',
    invalidate: [['cover-letters']],
    onSuccess: (cl) => navigate(`/cover-letters/${cl.id}`),
  })
  const remove = useMutationToast({
    mutationFn: () => jobService.remove(jobId),
    success: 'Job deleted',
    error: 'Could not delete the job',
    onSuccess: () => {
      qc.removeQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: ['jobs', 'list'] })
      navigate('/jobs', { replace: true })
    },
  })

  if (job.isPending) return <LoadingState label="Loading job…" />
  if (job.isError) {
    if (job.error instanceof ApiError && job.error.status === 404)
      return (
        <EmptyState
          title="Job not found"
          description="It may have been deleted."
          action={<Link to="/jobs" className={buttonClasses('outline', 'sm')}>Back to jobs</Link>}
        />
      )
    return <ErrorState error={job.error} onRetry={() => void job.refetch()} />
  }

  const j = job.data
  const salary = formatSalary(j)
  const postingUrl = j.posting_url || j.application_url
  const mandatory = j.requirements.filter((r) => r.is_mandatory)
  const optional = j.requirements.filter((r) => !r.is_mandatory)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Jobs
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{j.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {j.company}
              {j.location ? ` · ${j.location}` : ''}
              {j.workplace_type && j.workplace_type !== 'unknown' ? ` · ${WORKPLACE_LABELS[j.workplace_type] ?? j.workplace_type}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {j.is_demo && <Badge tone="warning">Demo job (fictional)</Badge>}
              {j.status === 'expired' ? <Badge tone="danger">No longer open</Badge> : <Badge tone="success">Open</Badge>}
              {j.hidden && <Badge>Hidden</Badge>}
              {j.saved && <Badge tone="primary">Saved</Badge>}
              {j.application_status && <ApplicationStatusBadge status={j.application_status} />}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {postingUrl && (
              <a href={postingUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses('outline')}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open original posting
              </a>
            )}
            {j.application_id ? (
              <Link to={`/applications/${j.application_id}`} className={buttonClasses('primary')}>
                <Briefcase className="h-4 w-4" aria-hidden="true" /> View application
              </Link>
            ) : null}
            {!j.application_status || ['discovered', 'shortlisted', 'resume_generated', 'needs_input', 'awaiting_approval', 'ready_to_submit', 'rejected_by_filter'].includes(j.application_status) ? (
              <Button onClick={() => setPrepareOpen(true)} variant={j.application_id ? 'outline' : 'primary'} disabled={j.status === 'expired'}>
                <Send className="h-4 w-4" aria-hidden="true" /> Prepare application
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => save.mutate(!!j.saved)} loading={save.isPending}>
            {j.saved ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
            {j.saved ? 'Unsave' : 'Save'}
          </Button>
          {!j.application_id && (
            <Button variant="outline" size="sm" onClick={() => track.mutate()} loading={track.isPending}>
              <Briefcase className="h-4 w-4" aria-hidden="true" /> Track
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => genResume.mutate()} loading={genResume.isPending}>
            <FileText className="h-4 w-4" aria-hidden="true" /> Generate resume
          </Button>
          <Button variant="outline" size="sm" onClick={() => genLetter.mutate()} loading={genLetter.isPending}>
            <Mail className="h-4 w-4" aria-hidden="true" /> Generate cover letter
          </Button>
          <Button variant="outline" size="sm" onClick={() => verify.mutate()} loading={verify.isPending}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verify still open
          </Button>
          <Button variant="outline" size="sm" onClick={() => rematch.mutate()} loading={rematch.isPending}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Re-match
          </Button>
          <Button variant="outline" size="sm" onClick={() => hide.mutate(!j.hidden)} loading={hide.isPending}>
            {j.hidden ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
            {j.hidden ? 'Unhide' : 'Hide'}
          </Button>
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
          </Button>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader
              title="Match breakdown"
              description="How this job compares with your approved profile. Scores are guidance only."
              actions={
                j.match ? (
                  <Button size="sm" variant="secondary" onClick={() => explain.mutate()} loading={explain.isPending}>
                    {!explain.isPending && <Sparkles className="h-4 w-4" aria-hidden="true" />} Explain with AI
                  </Button>
                ) : null
              }
            />
            <CardBody>
              {j.match ? (
                <div className="space-y-5">
                  {(aiSummary || j.match.llm_summary) && (
                    <Alert tone="info" title="AI explanation">
                      <p className="whitespace-pre-line">{aiSummary || j.match.llm_summary}</p>
                    </Alert>
                  )}
                  <MatchBreakdown match={j.match} />
                  <p className="text-xs text-subtle">Computed {formatRelative(j.match.computed_at)} against profile version {j.match.profile_version}.</p>
                </div>
              ) : (
                <EmptyState
                  title="Not matched yet"
                  description="Approve your candidate profile, then re-match this job."
                  action={
                    <>
                      <Button size="sm" onClick={() => rematch.mutate()} loading={rematch.isPending}>Match now</Button>
                      <Link to="/profile" className={buttonClasses('outline', 'sm')}>Open profile</Link>
                    </>
                  }
                />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Job description" />
            <CardBody>
              {j.description_text ? (
                <div className="max-h-[36rem] overflow-y-auto text-sm leading-6 whitespace-pre-line text-fg">{j.description_text}</div>
              ) : (
                <p className="text-sm text-subtle">No description text was captured for this posting.</p>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DefinitionList
                items={[
                  ['Company', j.company],
                  ['Location', j.location || '—'],
                  ['Workplace', WORKPLACE_LABELS[j.workplace_type] ?? humanize(j.workplace_type)],
                  ['Employment', j.employment_type || '—'],
                  ['Seniority', j.seniority ? humanize(j.seniority) : '—'],
                  ['Department', j.department || '—'],
                  ['Salary', salary || '—'],
                  ['Source', SOURCE_KIND_LABELS[j.source_kind] ?? humanize(j.source_kind)],
                  ['Posted', formatDate(j.posted_at)],
                  ['Discovered', formatDate(j.discovered_at)],
                  ['Last verified', formatDate(j.last_verified_at, true)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Requirements" description="Extracted from the posting." />
            <CardBody className="space-y-4">
              {j.requirements.length === 0 && <p className="text-sm text-subtle">No structured requirements were extracted.</p>}
              {[['Required', mandatory], ['Preferred / other', optional]].map(([label, list]) =>
                (list as typeof mandatory).length ? (
                  <div key={label as string}>
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">{label as string}</h3>
                    <ul className="space-y-1.5">
                      {(list as typeof mandatory).map((r, i) => (
                        <li key={i} className="text-sm text-fg">
                          <Badge className="mr-2">{humanize(r.kind)}</Badge>
                          {r.skill_name || r.text}
                          {r.skill_name && r.text && r.text !== r.skill_name && (
                            <span className="block pl-1 text-xs text-subtle">{r.text}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <PrepareApplicationDialog jobId={jobId} open={prepareOpen} onOpenChange={setPrepareOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this job?"
        description={
          j.application_id
            ? 'This permanently removes the job, its match AND its tracked application (including its history). To keep your records, hide the job instead.'
            : 'This permanently removes the job and its match. Discovery may find it again if it is still listed.'
        }
        confirmLabel="Delete job"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
