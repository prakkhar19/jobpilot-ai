import { Badge } from '@/components/ui'
import type { FieldAnswer, FormField } from '@/types/api'
import { ANSWER_SOURCE_LABELS } from '@/utils/constants'
import { humanize } from '@/utils/format'

function sourceTone(source: string) {
  if (source === 'user') return 'primary' as const
  if (source === 'profile' || source === 'facts' || source === 'document') return 'success' as const
  if (source === 'answer_bank') return 'info' as const
  return 'warning' as const
}

export function FormFieldsTable({
  fields,
  answers,
  missing,
}: {
  fields: FormField[]
  answers: Record<string, FieldAnswer>
  missing: FormField[]
}) {
  const missingNames = new Set(missing.map((m) => m.name))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-subtle">
            <th scope="col" className="px-4 py-2 font-medium">Question</th>
            <th scope="col" className="px-4 py-2 font-medium">Answer</th>
            <th scope="col" className="px-4 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const a = answers[f.name]
            return (
              <tr key={f.name} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-2.5">
                  <span className="text-fg">{f.label || f.name}</span>
                  {f.required && <span className="ml-1 text-xs text-danger">required</span>}
                  <div className="text-xs text-subtle">{humanize(f.type)}{f.kind !== 'standard' ? ` · ${humanize(f.kind)}` : ''}</div>
                </td>
                <td className="px-4 py-2.5 break-words text-fg">
                  {a?.value ? (
                    a.source === 'document' ? <span className="text-muted">Attached {humanize(a.value)}</span> : a.value
                  ) : missingNames.has(f.name) ? (
                    <span className="text-warning">Needs your answer</span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {a?.source ? (
                    <Badge tone={sourceTone(a.source)}>{ANSWER_SOURCE_LABELS[a.source] ?? humanize(a.source)}</Badge>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
