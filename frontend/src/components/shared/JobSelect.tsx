import { useQuery } from '@tanstack/react-query'
import { Field, Select } from '@/components/ui'
import { jobService } from '@/services/jobs'

/** Select for picking one of the user's jobs (most relevant first). */
export function JobSelect({
  value,
  onChange,
  label = 'Job',
  allowNone,
  noneLabel = 'No specific job (general)',
  required,
  hint,
}: {
  value: string
  onChange: (id: string) => void
  label?: string
  allowNone?: boolean
  noneLabel?: string
  required?: boolean
  hint?: string
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['jobs', 'select'],
    queryFn: () => jobService.list({ view: 'all', sort: 'score', page_size: 100 }),
  })
  return (
    <Field
      label={label}
      required={required}
      hint={isError ? 'Could not load jobs.' : hint}
    >
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={isPending}>
        {allowNone ? <option value="">{noneLabel}</option> : <option value="">{isPending ? 'Loading jobs…' : 'Select a job…'}</option>}
        {data?.items.map((j) => (
          <option key={j.id} value={j.id}>
            {j.title} — {j.company}
            {j.match_score !== null && j.match_score !== undefined ? ` (${Math.round(j.match_score)})` : ''}
          </option>
        ))}
      </Select>
    </Field>
  )
}
