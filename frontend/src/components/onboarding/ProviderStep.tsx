import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ProviderForm } from '@/components/integrations/ProviderForm'
import { ProviderTestButton } from '@/components/integrations/ProviderTestButton'
import { Badge, Button, ErrorState, LoadingState } from '@/components/ui'
import { aiProviderService } from '@/services/integrations'
import { StepFrame } from './StepFrame'

/** Step 3: optional AI provider. */
export function ProviderStep({ nav }: { nav: (primary: ReactNode) => ReactNode }) {
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['ai-providers'], queryFn: aiProviderService.list })
  const [adding, setAdding] = useState(false)
  const showForm = adding || (data && data.length === 0)

  return (
    <StepFrame
      title="Connect an AI provider (optional)"
      description="AI improves resume parsing, rewording (always fact-checked) and match explanations. Everything also works without it."
      footer={nav(null)}
    >
      {isPending && <LoadingState />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.length > 0 && (
        <ul className="mb-5 space-y-3">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-fg">
                  {p.name} {p.is_default && <Badge tone="primary">Default</Badge>}
                </p>
                <p className="text-xs text-subtle">{p.model}</p>
              </div>
              <ProviderTestButton providerId={p.id} />
            </li>
          ))}
        </ul>
      )}
      {data && data.length > 0 && !adding && (
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add another provider
        </Button>
      )}
      {showForm && (
        <ProviderForm
          submitLabel="Save provider"
          onCancel={adding ? () => setAdding(false) : undefined}
          onSaved={() => {
            setAdding(false)
            void qc.invalidateQueries({ queryKey: ['ai-providers'] })
          }}
        />
      )}
    </StepFrame>
  )
}
