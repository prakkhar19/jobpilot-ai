import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardBody, CardHeader, Field, Select } from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { applicationService } from '@/services/applications'
import { coverLetterService, resumeService } from '@/services/documents'
import type { Application, ApplicationUpdate } from '@/types/api'
import { formatDate } from '@/utils/format'
import { APPLICATION_KEY, isPreSubmission } from './helpers'

export function DocumentsCard({ app }: { app: Application }) {
  const editable = isPreSubmission(app.status) && !app.busy
  const resumes = useQuery({ queryKey: ['resume-versions', 'job', app.job_id], queryFn: () => resumeService.list(app.job_id) })
  const letters = useQuery({ queryKey: ['cover-letters', 'job', app.job_id], queryFn: () => coverLetterService.list(app.job_id) })
  const update = useMutationToast({
    mutationFn: (body: ApplicationUpdate) => applicationService.update(app.id, body),
    success: 'Documents updated',
    error: 'Could not change documents',
    invalidate: [APPLICATION_KEY(app.id), ['applications', 'events', app.id], ['applications', 'list']],
  })

  return (
    <Card>
      <CardHeader
        title="Documents"
        description={editable ? 'Choose which tailored resume and cover letter to send.' : 'Documents are locked after submission.'}
      />
      <CardBody className="space-y-4">
        <div>
          <Field label="Resume version" hint={resumes.isError ? 'Could not load resume versions.' : undefined}>
            <Select
              value={app.resume_version_id ?? ''}
              disabled={!editable || update.isPending || resumes.isPending}
              onChange={(e) => e.target.value && update.mutate({ resume_version_id: e.target.value })}
            >
              <option value="" disabled>
                {resumes.isPending ? 'Loading…' : 'No resume attached'}
              </option>
              {resumes.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  v{r.version_number} · {r.template} · {r.generation_method} · {formatDate(r.created_at)}
                </option>
              ))}
            </Select>
          </Field>
          {app.resume_version_id && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link to={`/resumes/${app.resume_version_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="h-3 w-3" aria-hidden="true" /> Open in Resume Studio
              </Link>
              <a href={resumeService.downloadUrl(app.resume_version_id, 'pdf')} download className="inline-flex items-center gap-1 text-primary hover:underline">
                <Download className="h-3 w-3" aria-hidden="true" /> PDF
              </a>
              <a href={resumeService.downloadUrl(app.resume_version_id, 'docx')} download className="inline-flex items-center gap-1 text-primary hover:underline">
                <Download className="h-3 w-3" aria-hidden="true" /> DOCX
              </a>
            </div>
          )}
        </div>
        <div>
          <Field label="Cover letter" hint={letters.isError ? 'Could not load cover letters.' : undefined}>
            <Select
              value={app.cover_letter_id ?? ''}
              disabled={!editable || update.isPending || letters.isPending}
              onChange={(e) => e.target.value && update.mutate({ cover_letter_id: e.target.value })}
            >
              <option value="" disabled>
                {letters.isPending ? 'Loading…' : 'No cover letter attached'}
              </option>
              {letters.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  v{l.version_number} · {l.generation_method}
                  {l.edited_by_user ? ' · edited' : ''} · {formatDate(l.created_at)}
                </option>
              ))}
            </Select>
          </Field>
          {app.cover_letter_id && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link to={`/cover-letters/${app.cover_letter_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="h-3 w-3" aria-hidden="true" /> Open in Cover Letter Studio
              </Link>
              <a href={coverLetterService.downloadUrl(app.cover_letter_id, 'pdf')} download className="inline-flex items-center gap-1 text-primary hover:underline">
                <Download className="h-3 w-3" aria-hidden="true" /> PDF
              </a>
            </div>
          )}
        </div>
        {app.status === 'ready_to_submit' && editable && (
          <p className="text-xs text-subtle">Changing documents will require approving the application again.</p>
        )}
      </CardBody>
    </Card>
  )
}
