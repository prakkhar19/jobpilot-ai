import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Alert, Button, Checkbox, ErrorState, Field, Input, LoadingState, TagInput } from '@/components/ui'
import { agentService, toConfigInput } from '@/services/agent'
import { errorMessage } from '@/services/api'
import { resumeService } from '@/services/documents'
import type { AgentConfig, WorkplacePref } from '@/types/api'
import { StepFrame } from './StepFrame'

const WORKPLACES: { key: WorkplacePref; label: string }[] = [
  { key: 'remote', label: 'Remote' },
  { key: 'hybrid', label: 'Hybrid' },
  { key: 'onsite', label: 'On-site' },
]

function Form({ config, onDone, nav }: { config: AgentConfig; onDone: () => void; nav: (primary: ReactNode) => ReactNode }) {
  const qc = useQueryClient()
  const templates = useQuery({ queryKey: ['resume-templates'], queryFn: resumeService.templates, staleTime: Infinity })
  const [roles, setRoles] = useState(config.target_roles)
  const [keywords, setKeywords] = useState(config.keywords)
  const [locations, setLocations] = useState(config.locations)
  const [workplaces, setWorkplaces] = useState<WorkplacePref[]>(config.workplace_types)
  const [minScore, setMinScore] = useState(String(config.min_match_score))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const score = Number(minScore)
    if (Number.isNaN(score) || score < 0 || score > 100) {
      setError('Minimum match score must be between 0 and 100.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await agentService.saveConfig({
        ...toConfigInput(config),
        target_roles: roles,
        keywords,
        locations,
        workplace_types: workplaces,
        min_match_score: score,
      })
      qc.setQueryData(['agent', 'config'], saved)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <StepFrame
      title="What are you looking for?"
      description="These preferences filter discovered jobs. You can fine-tune everything later in Settings."
      footer={nav(
        <Button onClick={save} loading={saving}>
          Save preferences
        </Button>,
      )}
    >
      <div className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <TagInput label="Target roles" value={roles} onChange={setRoles} suggestions={templates.data?.target_roles} placeholder="e.g. Machine Learning Engineer" />
        <TagInput label="Keywords" value={keywords} onChange={setKeywords} placeholder="e.g. Python, LLM" />
        <TagInput label="Locations" value={locations} onChange={setLocations} placeholder="e.g. Berlin, Remote (EU)" />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Workplace types</legend>
          <div className="flex flex-wrap gap-5">
            {WORKPLACES.map((w) => (
              <Checkbox
                key={w.key}
                label={w.label}
                checked={workplaces.includes(w.key)}
                onCheckedChange={(on) => setWorkplaces(on ? [...workplaces, w.key] : workplaces.filter((x) => x !== w.key))}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-subtle">Leave all unchecked to accept any.</p>
        </fieldset>
        <Field label="Minimum match score" hint="Jobs at or above this score are recommended (0–100).">
          <Input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} className="w-32" />
        </Field>
      </div>
    </StepFrame>
  )
}

/** Step 4: GET /api/agent/config then PUT the full object with the edited preferences. */
export function PreferencesStep({ onDone, nav }: { onDone: () => void; nav: (primary: ReactNode) => ReactNode }) {
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['agent', 'config'], queryFn: agentService.config })
  if (isPending || isError)
    return (
      <StepFrame title="What are you looking for?" footer={nav(null)}>
        {isPending ? <LoadingState /> : <ErrorState error={error} onRetry={() => void refetch()} />}
      </StepFrame>
    )
  return <Form config={data} onDone={onDone} nav={nav} />
}
