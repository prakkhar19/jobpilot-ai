import { Plus, Trash2 } from 'lucide-react'
import { Button, Input, Textarea } from '@/components/ui'

/** Editable list of strings (bullets, achievements…), one labelled input per item. */
export function StringListEditor({
  label,
  items,
  onChange,
  addLabel = 'Add item',
  multiline = false,
  placeholder,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  addLabel?: string
  multiline?: boolean
  placeholder?: string
}) {
  const set = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)))
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-fg">{label}</legend>
      {items.length === 0 && <p className="text-xs text-subtle">None yet.</p>}
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          {multiline ? (
            <Textarea
              rows={2}
              value={item}
              placeholder={placeholder}
              aria-label={`${label} ${i + 1}`}
              onChange={(e) => set(i, e.target.value)}
            />
          ) : (
            <Input value={item} placeholder={placeholder} aria-label={`${label} ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ''])}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {addLabel}
      </Button>
    </fieldset>
  )
}
