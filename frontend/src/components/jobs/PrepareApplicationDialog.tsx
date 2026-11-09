import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dialog } from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { applicationService } from '@/services/applications'
import type { ApplicationMode } from '@/types/api'
import { cn } from '@/utils/cn'

const MODES: { value: ApplicationMode; label: string; description: string }[] = [
  {
    value: 'review',
    label: 'Review',
    description: 'Prepare documents and answers; you open the application page and submit it yourself.',
  },
  {
    value: 'assisted',
    label: 'Assisted',
    description: 'Also pre-fill the application form in a sandboxed browser (where supported). Nothing is submitted.',
  },
  {
    value: 'authorized',
    label: 'Authorized',
    description:
      'Allows automated submission after your approval for sites that support it. Requires authorized automation to be enabled in Settings.',
  },
]

export function PrepareApplicationDialog({ jobId, open, onOpenChange }: { jobId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<ApplicationMode>('review')
  const prepare = useMutationToast({
    mutationFn: () => applicationService.prepare(jobId, mode),
    success: 'Application prepared',
    error: 'Could not prepare the application',
    invalidate: [['jobs'], ['applications']],
    onSuccess: (app) => {
      onOpenChange(false)
      navigate(`/applications/${app.id}`)
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Prepare application"
      description="Generates a tailored resume and cover letter if missing, reads the application form and maps your answers. Nothing is submitted without your approval."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={prepare.isPending}>
            Cancel
          </Button>
          <Button onClick={() => prepare.mutate()} loading={prepare.isPending}>
            Prepare
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-fg">Application mode</legend>
        {MODES.map((m) => (
          <label
            key={m.value}
            className={cn(
              'flex cursor-pointer gap-3 rounded-lg border p-3',
              mode === m.value ? 'border-primary bg-primary-soft/50' : 'border-border hover:bg-surface-2',
            )}
          >
            <input
              type="radio"
              name="mode"
              value={m.value}
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
              className="mt-1 accent-[var(--primary)]"
            />
            <span>
              <span className="block text-sm font-medium text-fg">{m.label}</span>
              <span className="block text-xs text-subtle">{m.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  )
}
