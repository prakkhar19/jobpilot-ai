import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { JobSelect } from '@/components/shared/JobSelect'
import { Button, Dialog, Field, Select, Switch } from '@/components/ui'
import { resumeService } from '@/services/documents'
import type { ResumeGenerateInput } from '@/types/api'

export function GenerateResumeDialog({
  open,
  onOpenChange,
  onGenerate,
  generating,
  defaultJobId = '',
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onGenerate: (body: ResumeGenerateInput) => void
  generating?: boolean
  defaultJobId?: string
}) {
  const templates = useQuery({ queryKey: ['resume-templates'], queryFn: resumeService.templates, staleTime: Infinity })
  const [jobId, setJobId] = useState(defaultJobId)
  const [role, setRole] = useState('')
  const [template, setTemplate] = useState('classic')
  const [useLlm, setUseLlm] = useState(true)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Generate a resume"
      description="Built only from your approved profile. Tailoring reorders and selects verified content; it never invents facts."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
          <Button
            loading={generating}
            onClick={() => onGenerate({ job_id: jobId || null, target_role: role, template, use_llm: useLlm })}
          >
            Generate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <JobSelect
          value={jobId}
          onChange={setJobId}
          label="Tailor for job"
          allowNone
          hint="Pick a job to tailor skills, bullets and keywords to it, or leave general."
        />
        <Field label="Target role" hint={templates.isError ? 'Could not load roles.' : 'Optional. Used for general resumes and labels.'}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{jobId ? 'Use the job title' : 'All roles'}</option>
            {templates.data?.target_roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Template">
          <Select value={template} onChange={(e) => setTemplate(e.target.value)} disabled={templates.isPending}>
            {(templates.data?.templates ?? [{ key: 'classic', name: 'Classic', description: '' }]).map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
                {t.description ? ` — ${t.description}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Switch
          checked={useLlm}
          onCheckedChange={setUseLlm}
          label="Use AI to rephrase (fact-checked)"
          description="Requires a configured AI provider and a selected job. Every AI suggestion is verified against your profile."
        />
      </div>
    </Dialog>
  )
}
