import { useState } from 'react'
import { JobSelect } from '@/components/shared/JobSelect'
import { Button, Dialog, Switch } from '@/components/ui'

export function GenerateLetterDialog({
  open,
  onOpenChange,
  onGenerate,
  generating,
  defaultJobId = '',
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onGenerate: (jobId: string, useLlm: boolean) => void
  generating?: boolean
  defaultJobId?: string
}) {
  const [jobId, setJobId] = useState(defaultJobId)
  const [useLlm, setUseLlm] = useState(true)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Generate a cover letter"
      description="Written from your approved profile and the job posting. Sentences with unverified claims are removed."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
          <Button
            loading={generating}
            onClick={() => {
              if (!jobId) {
                setError('Select a job.')
                return
              }
              onGenerate(jobId, useLlm)
            }}
          >
            Generate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <JobSelect value={jobId} onChange={(v) => { setJobId(v); setError(null) }} label="Job" required />
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        <Switch
          checked={useLlm}
          onCheckedChange={setUseLlm}
          label="Use AI (fact-checked)"
          description="Without an AI provider a verified template letter is used."
        />
      </div>
    </Dialog>
  )
}
