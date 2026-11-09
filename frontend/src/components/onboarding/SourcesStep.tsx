import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { DemoSourceButton } from '@/components/integrations/DemoSourceButton'
import { SourceDialog } from '@/components/integrations/SourceDialog'
import { Badge, Button, ErrorState, LoadingState } from '@/components/ui'
import { sourceService } from '@/services/integrations'
import { SOURCE_KIND_LABELS } from '@/utils/constants'
import { StepFrame } from './StepFrame'

/** Step 5: add job sources. */
export function SourcesStep({ nav }: { nav: (primary: ReactNode) => ReactNode }) {
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['sources'], queryFn: sourceService.list })
  const [adding, setAdding] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sources'] })
  return (
    <StepFrame
      title="Where should JobPilot look?"
      description="Add company job boards (Greenhouse, Lever, Ashby) or career pages. LinkedIn, Indeed and similar sites cannot be searched automatically — import those postings by pasting them later."
      footer={nav(null)}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add source
        </Button>
        <DemoSourceButton sources={data} onCreated={refresh} />
      </div>
      {isPending && <LoadingState />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.length === 0 && <p className="text-sm text-subtle">No sources added yet.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-2" aria-label="Configured sources">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-2.5">
              <span className="text-sm text-fg">{s.display_name || s.identifier}</span>
              <Badge>{SOURCE_KIND_LABELS[s.kind] ?? s.kind}</Badge>
            </li>
          ))}
        </ul>
      )}
      <SourceDialog open={adding} onOpenChange={setAdding} onCreated={refresh} />
    </StepFrame>
  )
}
