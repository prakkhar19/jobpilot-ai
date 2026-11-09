import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, FileText, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CompareView } from '@/components/documents/CompareView'
import { GenerateResumeDialog } from '@/components/documents/GenerateResumeDialog'
import { ResumeContentView } from '@/components/documents/ResumeContentView'
import { ResumeEditor } from '@/components/documents/ResumeEditor'
import { ChangeLogList, FactCheckReport, KeywordReportView } from '@/components/documents/ResumeReports'
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonClasses,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { ApiError } from '@/services/api'
import { resumeService } from '@/services/documents'
import type { ResumeContent, ResumeGenerateInput, ResumeVersion } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatDate, humanize } from '@/utils/format'

export default function ResumeStudioPage() {
  const { versionId } = useParams()
  const [params, setParams] = useSearchParams()
  const jobParam = params.get('job') ?? ''
  const navigate = useNavigate()
  const [genOpen, setGenOpen] = useState(!!jobParam)

  const list = useQuery({ queryKey: ['resume-versions', 'list'], queryFn: () => resumeService.list() })

  const generate = useMutationToast({
    mutationFn: (body: ResumeGenerateInput) => resumeService.generate(body),
    success: (v) => `Resume v${v.version_number} generated`,
    error: 'Could not generate resume',
    invalidate: [['resume-versions']],
    onSuccess: (v) => {
      closeGenerate()
      navigate(`/resumes/${v.id}`)
    },
  })

  const closeGenerate = () => {
    setGenOpen(false)
    if (jobParam) {
      const next = new URLSearchParams(params)
      next.delete('job')
      setParams(next, { replace: true })
    }
  }

  return (
    <div>
      <PageHeader
        title="Resume Studio"
        description="Tailored resume versions generated from your approved profile — every change is logged and fact-checked."
        actions={
          <Button onClick={() => setGenOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Generate resume
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className={cn(versionId && 'hidden lg:block')}>
          <Card>
            {list.isPending ? (
              <LoadingState label="Loading versions…" />
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : list.data.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" aria-hidden="true" />}
                title="No resumes yet"
                description="Generate a general resume or one tailored to a job."
                action={<Button onClick={() => setGenOpen(true)}>Generate resume</Button>}
              />
            ) : (
              <ul className="divide-y divide-border" aria-label="Resume versions">
                {list.data.map((v) => (
                  <li key={v.id}>
                    <Link
                      to={`/resumes/${v.id}`}
                      aria-current={v.id === versionId ? 'page' : undefined}
                      className={cn(
                        'block px-4 py-3 hover:bg-surface-2',
                        v.id === versionId && 'bg-primary-soft hover:bg-primary-soft',
                      )}
                    >
                      <p className="truncate text-sm font-medium text-fg">{v.label}</p>
                      <p className="mt-0.5 text-xs text-subtle">
                        v{v.version_number} · {v.template} · {humanize(v.generation_method)} · {formatDate(v.created_at)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="min-w-0">
          {versionId ? (
            <VersionView key={versionId} versionId={versionId} />
          ) : (
            list.data &&
            list.data.length > 0 && (
              <Card>
                <EmptyState title="Select a version" description="Choose a resume version to preview, compare, edit or download it." />
              </Card>
            )
          )}
        </div>
      </div>
      {genOpen && (
        <GenerateResumeDialog
          open={genOpen}
          onOpenChange={(o) => (o ? setGenOpen(true) : closeGenerate())}
          defaultJobId={jobParam}
          generating={generate.isPending}
          onGenerate={(b) => generate.mutate(b)}
        />
      )}
    </div>
  )
}

function VersionView({ versionId }: { versionId: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('preview')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const q = useQuery({ queryKey: ['resume-versions', 'detail', versionId], queryFn: () => resumeService.get(versionId) })
  const templates = useQuery({ queryKey: ['resume-templates'], queryFn: resumeService.templates, staleTime: Infinity })

  const edit = useMutationToast({
    mutationFn: (v: { content: ResumeContent; template: string }) => resumeService.edit(versionId, v.content, v.template),
    success: (v: ResumeVersion) => `Saved as v${v.version_number}`,
    error: 'Could not save edits',
    invalidate: [['resume-versions', 'list'], ['resume-versions', 'job']],
    onSuccess: (v) => navigate(`/resumes/${v.id}`),
  })
  const del = useMutationToast({
    mutationFn: () => resumeService.remove(versionId),
    success: 'Resume version deleted',
    error: 'Could not delete',
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['resume-versions', 'detail', versionId] })
      void qc.invalidateQueries({ queryKey: ['resume-versions', 'list'] })
      navigate('/resumes', { replace: true })
    },
  })

  if (q.isPending) return <Card><LoadingState label="Loading resume…" /></Card>
  if (q.isError)
    return (
      <Card>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState title="Resume version not found" description="It may have been deleted." />
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )}
      </Card>
    )
  const v = q.data
  return (
    <div className="space-y-4">
      <Link to="/resumes" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg lg:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All versions
      </Link>
      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{v.label}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="primary">v{v.version_number}</Badge>
              <Badge>{v.template}</Badge>
              <Badge tone={v.generation_method.includes('llm') ? 'info' : 'neutral'}>{humanize(v.generation_method)}</Badge>
              {v.target_role && <Badge>{v.target_role}</Badge>}
            </div>
            <p className="mt-2 text-xs text-subtle">
              Created {formatDate(v.created_at, true)}
              {v.model && ` · ${v.provider} ${v.model}`}
              {v.job_id && (
                <>
                  {' · '}
                  <Link to={`/jobs/${v.job_id}`} className="text-primary hover:underline">
                    View job
                  </Link>
                </>
              )}
              {v.parent_version_id && (
                <>
                  {' · '}
                  <Link to={`/resumes/${v.parent_version_id}`} className="text-primary hover:underline">
                    Parent version
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={resumeService.downloadUrl(v.id, 'pdf')} download className={buttonClasses('outline', 'sm')}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> PDF
            </a>
            <a href={resumeService.downloadUrl(v.id, 'docx')} download className={buttonClasses('outline', 'sm')}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> DOCX
            </a>
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
            </Button>
          </div>
        </CardBody>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Resume version views">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="pdf">PDF</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="factcheck">Fact-check</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="edit">Edit</TabsTrigger>
        </TabsList>
        <TabsContent value="preview">
          <Card>
            <CardBody>
              <ResumeContentView content={v.content} />
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="pdf">
          <Card className="overflow-hidden">
            <iframe
              src={resumeService.previewUrl(v.id)}
              title={`PDF preview of ${v.label} v${v.version_number}`}
              className="h-[80vh] w-full bg-white"
            />
          </Card>
        </TabsContent>
        <TabsContent value="changes">
          <Card>
            <CardBody>
              <ChangeLogList entries={v.change_log ?? []} />
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="factcheck">
          <Card>
            <CardBody>
              <FactCheckReport report={v.fact_check ?? {}} changeLog={v.change_log ?? []} />
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="keywords">
          <Card>
            <CardBody>
              <KeywordReportView content={v.content} />
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="compare">
          <CompareView versionId={v.id} />
        </TabsContent>
        <TabsContent value="edit">
          <Card>
            <CardBody>
              <ResumeEditor
                content={v.content}
                template={v.template}
                templates={templates.data?.templates ?? []}
                saving={edit.isPending}
                onCancel={() => setTab('preview')}
                onSave={(content, template) => edit.mutate({ content, template })}
              />
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this resume version?"
        description="The version and its PDF/DOCX files are deleted permanently. Applications using it will need another resume."
        destructive
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  )
}
