import { useState, type FormEvent } from 'react'
import { Button, Checkbox, Field, Input, Select, Textarea } from '@/components/ui'
import type { FormField } from '@/types/api'

interface Props {
  fields: FormField[]
  /** Existing answers (value only) used as defaults. */
  initial?: Record<string, string>
  onSubmit: (answers: Record<string, string>, saveToBank: boolean) => void
  submitting?: boolean
  submitLabel?: string
}

/**
 * Form for the required screening questions the agent could not answer from the profile,
 * application facts or answer bank. Fields with `options` render as a select.
 */
export function MissingAnswersForm({ fields, initial = {}, onSubmit, submitting, submitLabel = 'Save answers' }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? ''])),
  )
  const [save, setSave] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handle = (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    for (const f of fields) if (f.required && !values[f.name]?.trim()) next[f.name] = 'This answer is required.'
    setErrors(next)
    if (Object.keys(next).length) return
    const answers = Object.fromEntries(
      Object.entries(values)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v),
    )
    onSubmit(answers, save)
  }

  return (
    <form onSubmit={handle} noValidate className="space-y-4" aria-label="Answer required questions">
      {fields.map((f) => {
        const common = {
          value: values[f.name] ?? '',
          onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.name]: e.target.value })),
        }
        return (
          <Field key={f.name} label={f.label || f.name} required={f.required} error={errors[f.name]}>
            {f.options?.length ? (
              <Select {...common}>
                <option value="">Select an answer…</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : f.type === 'textarea' ? (
              <Textarea rows={3} {...common} />
            ) : (
              <Input
                type={['email', 'tel', 'url'].includes(f.type) ? f.type : 'text'}
                {...common}
              />
            )}
          </Field>
        )
      })}
      <Checkbox
        checked={save}
        onCheckedChange={setSave}
        label="Save these answers to my answer bank"
        description="Saved answers are reused automatically for the same question on future applications."
      />
      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
