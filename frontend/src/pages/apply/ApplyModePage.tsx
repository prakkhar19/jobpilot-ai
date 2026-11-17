import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, Copy, ExternalLink, FileDown, MapPin, PartyPopper, SkipForward, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, CardBody, ErrorState, LoadingState, PageHeader, ScoreRing, buttonClasses } from '@/components/ui'
import { applyQueueService } from '@/services/applyQueue'
import { errorMessage } from '@/services/api'
import { resumeService } from '@/services/documents'
import { jobService } from '@/services/jobs'
import type { ApplyQueueItem } from '@/types/api'
import { cn } from '@/utils/cn'
import { confetti } from '@/utils/confetti'
import { SOURCE_KIND_LABELS, WORKPLACE_LABELS } from '@/utils/constants'
import { formatRelative, humanize } from '@/utils/format'

const QUEUE_KEY = ['apply-queue']

function Step({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
          done ? 'bg-success text-white dark:text-bg' : 'bg-surface-2 text-subtle',
        )}
        aria-hidden="true"
      >
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export default function ApplyModePage() {
  const qc = useQueryClient()
  const queue = useQuery({ queryKey: QUEUE_KEY, queryFn: () => applyQueueService.list() })
  const [index, setIndex] = useState(0)
  const [steps, setSteps] = useState({ opened: false, resume: false, letter: false })
  const [sessionApplied, setSessionApplied] = useState(0)

  const items = queue.data?.items ?? []
  const item: ApplyQueueItem | undefined = items[Math.min(index, Math.max(0, items.length - 1))]
  const resetSteps = () => setSteps({ opened: false, resume: false, letter: false })

  const prepare = useMutation({
    mutationFn: (jobId: string) => applyQueueService.prepare(jobId),
    onSuccess: (updated) => {
      qc.setQueryData(QUEUE_KEY, (old: typeof queue.data) =>
        old ? { ...old, items: old.items.map((i) => (i.job_id === updated.job_id ? updated : i)) } : old,
      )
    },
    onError: (err) => toast.error('Could not prepare documents', { description: errorMessage(err) }),
  })

  const applied = useMutation({
    mutationFn: (jobId: string) => applyQueueService.applied(jobId),
    onSuccess: (_d, jobId) => {
      setSessionApplied((n) => n + 1)
      qc.setQueryData(QUEUE_KEY, (old: typeof queue.data) =>
        old ? { ...old, total: old.total - 1, applied_today: old.applied_today + 1, items: old.items.filter((i) => i.job_id !== jobId) } : old,
      )
      void qc.invalidateQueries({ queryKey: ['analytics'] })
      void qc.invalidateQueries({ queryKey: ['applications'] })
      resetSteps()
      const left = (queue.data?.items.length ?? 1) - 1
      if (left === 0) confetti({ pieces: 200 })
      else toast.success('Nice! Marked as applied.', { description: `${left} to go.` })
    },
    onError: (err) => toast.error('Could not mark as applied', { description: errorMessage(err) }),
  })

  const skip = useMutation({
    mutationFn: (jobId: string) => jobService.hide(jobId, true),
    onSuccess: (_d, jobId) => {
      qc.setQueryData(QUEUE_KEY, (old: typeof queue.data) =>
        old ? { ...old, total: old.total - 1, items: old.items.filter((i) => i.job_id !== jobId) } : old,
      )
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      resetSteps()
      toast('Skipped — hidden from your jobs.', {
        action: { label: 'Undo', onClick: () => void jobService.hide(jobId, false).then(() => qc.invalidateQueries({ queryKey: QUEUE_KEY })) },
      })
    },
    onError: (err) => toast.error('Could not skip', { description: errorMessage(err) }),
  })

  // Prepare documents automatically when a job without them comes up.
  const needsDocs = item && (!item.resume_version_id || !item.cover_letter_id)
  const { mutate: prepareMutate, isPending: preparing } = prepare
  useEffect(() => {
    if (item && needsDocs && !preparing && !prepare.isError) prepareMutate(item.job_id)
  }, [item, needsDocs, preparing, prepare.isError, prepareMutate])

  const copyLetter = async () => {
    if (!item?.cover_letter) return
    try {
      await navigator.clipboard.writeText(item.cover_letter)
      setSteps((s) => ({ ...s, letter: true }))
      toast.success('Cover letter copied')
    } catch {
      toast.error('Could not copy. Open the cover letter and copy it manually.')
    }
  }

  const next = () => {
    resetSteps()
    setIndex((i) => (i + 1 < items.length ? i + 1 : 0))
  }

  // Desktop shortcuts: O open, R resume, C copy letter, A applied, S skip, N next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = e.key.toLowerCase()
      if (k === 'o' && item.apply_url) {
        window.open(item.apply_url, '_blank', 'noopener,noreferrer')
        setSteps((s) => ({ ...s, opened: true }))
      } else if (k === 'r' && item.resume_version_id) {
        window.open(resumeService.downloadUrl(item.resume_version_id, 'pdf'), '_blank')
        setSteps((s) => ({ ...s, resume: true }))
      } else if (k === 'c') void copyLetter()
      else if (k === 'a') applied.mutate(item.job_id)
      else if (k === 's') skip.mutate(item.job_id)
      else if (k === 'n') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (queue.isPending) return <LoadingState label="Loading your apply queue…" />
  if (queue.isError) return <ErrorState error={queue.error} title="Could not load your apply queue" onRetry={() => void queue.refetch()} />

  const total = queue.data.total
  const today = queue.data.applied_today
  const goal = Math.max(5, today + Math.min(total, 5))
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Apply <span className="text-gradient">Mode</span>
          </span>
        }
        description="Your best jobs, one at a time, with your tailored resume and cover letter ready. Apply on the employer's site, then tap “I applied”."
      />

      <Card className="animate-fade-up">
        <CardBody className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-fg">Today: {today} applied</span>
              <span className="text-xs text-subtle">{total} waiting</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Applied today" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={today}>
              <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.min(100, (today / goal) * 100)}%` }} />
            </div>
          </div>
          {sessionApplied > 0 && <Badge tone="success">+{sessionApplied} this session</Badge>}
        </CardBody>
      </Card>

      {!item ? (
        <Card className="animate-fade-up">
          <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-12 w-12 animate-float items-center justify-center rounded-full bg-brand text-white">
              <PartyPopper className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-semibold text-fg">All caught up!</h2>
            <p className="max-w-sm text-sm text-subtle">
              No jobs scoring {queue.data.min_score}+ are waiting. The agent keeps searching and new matches will show up here.
            </p>
            <Link to="/jobs/recommended" className={buttonClasses('outline', 'md')}>
              Browse recommended jobs
            </Link>
          </CardBody>
        </Card>
      ) : (
        <Card key={item.job_id} className="animate-fade-up overflow-hidden">
          <div className="relative border-b border-border p-5 sm:p-6">
            <div aria-hidden="true" className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-brand opacity-15 blur-3xl" />
            <div className="relative flex items-start gap-4">
              <ScoreRing score={item.match_score} size={64} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-subtle">
                  Job {Math.min(index, items.length - 1) + 1} of {total}
                </p>
                <Link to={`/jobs/${item.job_id}`} className="mt-0.5 block text-lg font-semibold text-fg hover:text-primary">
                  {item.title}
                </Link>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-subtle">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.company}
                  </span>
                  {item.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {item.location}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.workplace_type !== 'unknown' && <Badge>{WORKPLACE_LABELS[item.workplace_type] ?? item.workplace_type}</Badge>}
                  <Badge>{SOURCE_KIND_LABELS[item.source_kind] ?? humanize(item.source_kind)}</Badge>
                  {item.discovered_at && <Badge>Found {formatRelative(item.discovered_at)}</Badge>}
                </div>
              </div>
            </div>
          </div>

          <CardBody className="space-y-4 p-5 sm:p-6">
            {needsDocs ? (
              <div className="flex items-center gap-3 rounded-lg bg-primary-soft px-4 py-3 text-sm text-primary">
                <Wand2 className="h-4 w-4 animate-pulse" aria-hidden="true" />
                {prepare.isError ? (
                  <span className="flex-1">
                    Could not prepare documents.{' '}
                    <button type="button" className="font-medium underline" onClick={() => prepare.mutate(item.job_id)}>
                      Try again
                    </button>
                  </span>
                ) : (
                  'Tailoring your resume and cover letter for this job…'
                )}
              </div>
            ) : (
              <>
                <Step n={1} done={steps.opened}>
                  <a
                    href={item.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSteps((s) => ({ ...s, opened: true }))}
                    className={buttonClasses('outline', 'md', 'w-full justify-start')}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open the job &amp; click Apply <span className="font-normal text-subtle">(1-click uses your profile resume)</span>
                  </a>
                </Step>
                <Step n={2} done={steps.resume}>
                  <a
                    href={resumeService.downloadUrl(item.resume_version_id!, 'pdf')}
                    onClick={() => setSteps((s) => ({ ...s, resume: true }))}
                    className={buttonClasses('outline', 'md', 'w-full justify-start')}
                  >
                    <FileDown className="h-4 w-4" aria-hidden="true" /> Download my tailored resume <span className="font-normal text-subtle">(only if they ask for an upload)</span>
                  </a>
                </Step>
                <Step n={3} done={steps.letter}>
                  <Button variant="outline" className="w-full justify-start" onClick={() => void copyLetter()}>
                    <Copy className="h-4 w-4" aria-hidden="true" /> Copy cover letter (if they ask)
                  </Button>
                </Step>
                <details className="rounded-lg border border-border bg-surface-2/50 px-4 py-2 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-subtle">Preview cover letter</summary>
                  <p className="mt-2 whitespace-pre-line text-muted">{item.cover_letter}</p>
                </details>
              </>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button
                className="flex-1 bg-brand text-white sm:flex-none"
                onClick={() => applied.mutate(item.job_id)}
                loading={applied.isPending}
                disabled={needsDocs}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> I applied
              </Button>
              <Button variant="ghost" onClick={next} disabled={items.length < 2}>
                Later
              </Button>
              <Button variant="ghost" className="ml-auto text-subtle" onClick={() => skip.mutate(item.job_id)} loading={skip.isPending}>
                <SkipForward className="h-4 w-4" aria-hidden="true" /> Not for me
              </Button>
            </div>
            <p className="hidden text-[11px] text-subtle sm:block">
              Shortcuts: <kbd>O</kbd> open · <kbd>R</kbd> resume · <kbd>C</kbd> copy letter · <kbd>A</kbd> applied · <kbd>N</kbd> later · <kbd>S</kbd> not for me
            </p>
          </CardBody>
        </Card>
      )}
      <p className="text-center text-xs text-subtle">
        JobPilot never applies on Naukri or LinkedIn for you. Those sites ban bots. It gets everything ready so applying takes seconds.
      </p>
    </div>
  )
}
