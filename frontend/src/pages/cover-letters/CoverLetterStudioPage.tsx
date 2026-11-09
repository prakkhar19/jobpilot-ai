import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Mail, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { GenerateLetterDialog } from '@/components/documents/GenerateLetterDialog'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Textarea,
  buttonClasses,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { ApiError } from '@/services/api'
import { coverLetterService } from '@/services/documents'
import { jobService } from '@/services/jobs'
import type { CoverLetter } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatDate, humanize } from '@/utils/format'

export default function CoverLetterStudioPage() {
  const { letterId } = useParams()
  const [params, setParams] = useSearchParams()
  const jobParam = params.get('job') ?? ''
  const navigate = useNavigate()
  const [genOpen, setGenOpen] = useState(!!jobParam)
  const list = useQuery({ queryKey: ['cover-letters', 'list'], queryFn: () => coverLetterService.list() })
  const jobs = useQuery({ queryKey: ['jobs', 'select'], queryFn: () => jobService.list({ view: 'all', sort: 'score', page_size: 100 }) })
  const jobName = (id: string | null) => {
    const j = id ? jobs.data?.items.find((x) => x.id === id) : undefined
    return j ? `${j.company} — ${j.title}` : id ? 'Job cover letter' : 'General cover letter'
  }

  const closeGenerate = () => {
    setGenOpen(false)
    if (jobParam) {
      const next = new URLSearchParams(params)
      next.delete('job')
      setParams(next, { replace: true })
    }
  }

  const generate = useMutationToast({
    mutationFn: (v: { jobId: string; useLlm: boolean }) => coverLetterService.generate(v.jobId, v.useLlm),
    success: (l) => `Cover letter v${l.version_number} generated`,
    error: 'Could not generate cover letter',
    invalidate: [['cover-letters']],
    onSuccess: (l) => {
      closeGenerate()
      navigate(`/cover-letters/${l.id}`)
    },
  })

  return (
    <div>
      <PageHeader
        title="Cover Letter Studio"
        description="Job-specific cover letters, fact-checked against your profile. Edit freely before sending."
        actions={
          <Button onClick={() => setGenOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Generate letter
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className={cn(letterId && 'hidden lg:block')}>
          <Card>
            {list.isPending ? (
              <LoadingState label="Loading cover letters…" />
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : list.data.length === 0 ? (
              <EmptyState
                icon={<Mail className="h-5 w-5" aria-hidden="true" />}
                title="No cover letters yet"
                description="Generate a letter for any job you are interested in."
                action={<Button onClick={() => setGenOpen(true)}>Generate letter</Button>}
              />
            ) : (
              <ul className="divide-y divide-border" aria-label="Cover letters">
                {list.data.map((l) => (
                  <li key={l.id}>
                    <Link
                      to={`/cover-letters/${l.id}`}
                      aria-current={l.id === letterId ? 'page' : undefined}
                      className={cn('block px-4 py-3 hover:bg-surface-2', l.id === letterId && 'bg-primary-soft hover:bg-primary-soft')}
                    >
                      <p className="truncate text-sm font-medium text-fg">{jobName(l.job_id)}</p>
                      <p className="mt-0.5 text-xs text-subtle">
                        v{l.version_number} · {humanize(l.generation_method)}
                        {l.edited_by_user ? ' · edited' : ''} · {formatDate(l.created_at)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="min-w-0">
          {letterId ? (
            <LetterView key={letterId} letterId={letterId} title={jobName} />
          ) : (
            list.data &&
            list.data.length > 0 && (
              <Card>
                <EmptyState title="Select a cover letter" description="Choose a letter to read, edit or download it." />
              </Card>
            )
          )}
        </div>
      </div>
      {genOpen && (
        <GenerateLetterDialog
          open={genOpen}
          onOpenChange={(o) => (o ? setGenOpen(true) : closeGenerate())}
          defaultJobId={jobParam}
          generating={generate.isPending}
          onGenerate={(jobId, useLlm) => generate.mutate({ jobId, useLlm })}
        />
      )}
    </div>
  )
}

function LetterView({ letterId, title }: { letterId: string; title: (jobId: string | null) => string }) {
  const q = useQuery({ queryKey: ['cover-letters', 'detail', letterId], queryFn: () => coverLetterService.get(letterId) })
  if (q.isPending) return <Card><LoadingState label="Loading letter…" /></Card>
  if (q.isError)
    return (
      <Card>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState title="Cover letter not found" description="It may have been deleted." />
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )}
      </Card>
    )
  return <LetterEditor key={q.data.updated_at} letter={q.data} title={title(q.data.job_id)} />
}

function LetterEditor({ letter, title }: { letter: CoverLetter; title: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [content, setContent] = useState(letter.content)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty = content !== letter.content

  const save = useMutationToast({
    mutationFn: () => coverLetterService.update(letter.id, content),
    success: 'Cover letter saved',
    error: 'Could not save',
    onSuccess: (l) => {
      qc.setQueryData(['cover-letters', 'detail', letter.id], l)
      void qc.invalidateQueries({ queryKey: ['cover-letters', 'list'] })
    },
  })
  const regenerate = useMutationToast({
    mutationFn: () => coverLetterService.generate(letter.job_id as string, true),
    success: (l) => `Generated v${l.version_number}`,
    error: 'Could not regenerate',
    invalidate: [['cover-letters']],
    onSuccess: (l) => navigate(`/cover-letters/${l.id}`),
  })
  const del = useMutationToast({
    mutationFn: () => coverLetterService.remove(letter.id),
    success: 'Cover letter deleted',
    error: 'Could not delete',
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['cover-letters', 'detail', letter.id] })
      void qc.invalidateQueries({ queryKey: ['cover-letters', 'list'] })
      navigate('/cover-letters', { replace: true })
    },
  })

  const fc = letter.fact_check ?? {}
  const removed = fc.removed_sentences ?? []

  return (
    <div className="space-y-4">
      <Link to="/cover-letters" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg lg:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All letters
      </Link>
      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{title}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="primary">v{letter.version_number}</Badge>
              <Badge tone={letter.generation_method.includes('llm') ? 'info' : 'neutral'}>{humanize(letter.generation_method)}</Badge>
              {letter.edited_by_user && <Badge tone="success">Edited by you</Badge>}
            </div>
            <p className="mt-2 text-xs text-subtle">
              Updated {formatDate(letter.updated_at, true)}
              {letter.model && ` · ${letter.provider} ${letter.model}`}
              {letter.job_id && (
                <>
                  {' · '}
                  <Link to={`/jobs/${letter.job_id}`} className="text-primary hover:underline">
                    View job
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['pdf', 'docx', 'txt'] as const).map((fmt) => (
              <a key={fmt} href={coverLetterService.downloadUrl(letter.id, fmt)} download className={buttonClasses('outline', 'sm')}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> {fmt.toUpperCase()}
              </a>
            ))}
          </div>
        </CardBody>
      </Card>
      {dirty && <Alert tone="warning">You have unsaved changes. Downloads use the saved version.</Alert>}

      <Card>
        <CardHeader
          title="Letter"
          actions={
            <>
              {letter.job_id && (
                <Button variant="outline" size="sm" onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Regenerate
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
              </Button>
            </>
          }
        />
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
            className="space-y-3"
          >
            <Field label="Cover letter text">
              <Textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)} className="font-[inherit] leading-7" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setContent(letter.content)}>
                Discard
              </Button>
              <Button type="submit" disabled={!dirty || !content.trim()} loading={save.isPending}>
                Save
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Fact-check" description="Sentences making claims not supported by your profile are removed automatically." />
        <CardBody className="space-y-3">
          {fc.note && <Alert tone="info">{fc.note}</Alert>}
          {removed.length ? (
            <ul className="space-y-2 text-sm">
              {removed.map((s, i) => (
                <li key={i} className="rounded-md bg-danger-soft/60 p-2 text-muted">
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">No sentences were removed.</p>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this cover letter?"
        description="This version is deleted permanently."
        destructive
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  )
}
