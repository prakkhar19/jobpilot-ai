import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  buttonClasses,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { resumeFileService } from '@/services/profiles'
import type { MasterResume } from '@/types/api'
import { formatBytes, formatDate } from '@/utils/format'

const MASTER_RESUMES_KEY = ['master-resumes'] as const

function TextDialog({ resume, onClose }: { resume: MasterResume | null; onClose: () => void }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['master-resumes', resume?.id, 'text'],
    queryFn: () => resumeFileService.text(resume!.id),
    enabled: !!resume,
  })
  return (
    <Dialog
      open={!!resume}
      onOpenChange={(o) => !o && onClose()}
      title="Extracted text"
      description={resume?.original_filename}
      size="lg"
    >
      {isPending && <LoadingState />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-surface-2 p-4 text-xs whitespace-pre-wrap text-fg">
          {data.text || 'No text could be extracted from this file.'}
        </pre>
      )}
    </Dialog>
  )
}

/** Original (immutable) uploaded resumes: download, view extracted text, delete. */
export function ResumeFilesList() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: MASTER_RESUMES_KEY,
    queryFn: resumeFileService.list,
  })
  const [viewing, setViewing] = useState<MasterResume | null>(null)
  const [deleting, setDeleting] = useState<MasterResume | null>(null)
  const remove = useMutationToast({
    mutationFn: (id: string) => resumeFileService.remove(id),
    success: 'Resume file deleted',
    error: 'Could not delete the file',
    invalidate: [MASTER_RESUMES_KEY, ['profiles']],
    onSuccess: () => setDeleting(null),
  })

  return (
    <Card>
      <CardHeader title="Original resumes" description="Uploaded files are stored unchanged on this server." />
      {isPending && <LoadingState />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState title="No uploaded resumes" description="Upload a PDF or DOCX to create a profile from it." icon={<FileText className="h-5 w-5" />} />
      )}
      {data && data.length > 0 && (
        <ul className="divide-y divide-border">
          {data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{r.label || r.original_filename}</p>
                <p className="text-xs text-subtle">
                  {r.original_filename} · {formatBytes(r.size_bytes)} · {formatDate(r.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={resumeFileService.downloadUrl(r.id)}
                  download={r.original_filename}
                  className={buttonClasses('ghost', 'sm')}
                  aria-label={`Download ${r.original_filename}`}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                </a>
                <Button variant="ghost" size="sm" onClick={() => setViewing(r)} aria-label={`View text of ${r.original_filename}`}>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Text
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} aria-label={`Delete ${r.original_filename}`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <TextDialog resume={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this resume file?"
        description={`${deleting?.original_filename ?? ''} will be permanently removed. Profiles created from it are kept.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  )
}
