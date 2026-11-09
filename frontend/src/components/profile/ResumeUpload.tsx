import { FileUp, UploadCloud } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { Alert, Button, Checkbox, Field, Input } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { resumeFileService } from '@/services/profiles'
import type { UploadResult } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatBytes } from '@/utils/format'

const ACCEPTED = ['.pdf', '.docx']

function isAcceptedResume(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED.some((ext) => name.endsWith(ext))
}

/** Drag & drop PDF/DOCX upload → POST /api/resumes (creates a draft profile from the parsed resume). */
export function ResumeUpload({
  aiAvailable,
  onUploaded,
  showLabel = true,
  submitLabel = 'Upload & extract',
}: {
  aiAvailable: boolean
  onUploaded: (result: UploadResult) => void
  showLabel?: boolean
  submitLabel?: string
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [useLlm, setUseLlm] = useState(aiAvailable)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const pick = (f: File | undefined | null) => {
    if (!f) return
    if (!isAcceptedResume(f)) {
      setError('Please choose a PDF or DOCX file.')
      setFile(null)
      return
    }
    setError(null)
    setFile(f)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files?.[0])
  }

  const upload = async () => {
    if (!file) {
      setError('Choose a resume file first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const result = await resumeFileService.upload(file, aiAvailable && useLlm, label.trim())
      toast.success('Resume uploaded', { description: 'Review the extracted profile before approving it.' })
      setFile(null)
      setLabel('')
      if (inputRef.current) inputRef.current.value = ''
      onUploaded(result)
    } catch (err) {
      setError(errorMessage(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-border-strong bg-surface-2/40',
        )}
      >
        <UploadCloud className="mb-3 h-8 w-8 text-subtle" aria-hidden="true" />
        <p className="text-sm font-medium text-fg">Drag & drop your resume here</p>
        <p className="mt-1 text-xs text-subtle">PDF or DOCX. The original file is kept unchanged.</p>
        <label htmlFor={inputId} className="mt-4 cursor-pointer">
          <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-xs font-medium text-fg hover:bg-surface-2">
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Choose file
          </span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            aria-label="Resume file"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
        {file && (
          <p className="mt-3 text-sm text-fg" aria-live="polite">
            Selected: <span className="font-medium">{file.name}</span> ({formatBytes(file.size)})
          </p>
        )}
      </div>
      {showLabel && (
        <Field label="Label (optional)" hint="e.g. 'ML-focused resume'">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
        </Field>
      )}
      <Checkbox
        label="Use AI to improve extraction"
        description={
          aiAvailable
            ? 'Sends the resume text to your configured AI provider for more accurate parsing.'
            : 'Configure an AI provider in Integrations to enable this. Rule-based extraction is used otherwise.'
        }
        checked={aiAvailable && useLlm}
        disabled={!aiAvailable}
        onCheckedChange={setUseLlm}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button onClick={upload} loading={uploading} disabled={!file}>
        {submitLabel}
      </Button>
    </div>
  )
}
