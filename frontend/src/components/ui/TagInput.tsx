import { X } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'
import { cn } from '@/utils/cn'

interface TagInputProps {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  hint?: string
  id?: string
  max?: number
  className?: string
  suggestions?: string[]
}

/** Accessible chip input: type and press Enter or comma to add; Backspace removes the last chip. */
export function TagInput({ label, value, onChange, placeholder, hint, id, max, className, suggestions }: TagInputProps) {
  const auto = useId()
  const inputId = id ?? auto
  const listId = `${inputId}-suggestions`
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) return
    const next = [...value]
    for (const p of parts) {
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p)
    }
    onChange(max ? next.slice(0, max) : next)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={inputId} className="block text-sm font-medium text-fg">
        {label}
      </label>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2 py-1.5',
          'focus-within:border-ring focus-within:outline-2 focus-within:outline-ring/40',
        )}
      >
        <ul className="contents" aria-label={`${label} values`}>
          {value.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== tag))}
                className="rounded hover:bg-primary/10"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? '' : placeholder}
          list={suggestions?.length ? listId : undefined}
          aria-describedby={`${inputId}-hint`}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-fg outline-none placeholder:text-subtle"
        />
        {suggestions?.length ? (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        ) : null}
      </div>
      <p id={`${inputId}-hint`} className="text-xs text-subtle">
        {hint ?? 'Press Enter or comma to add.'}
      </p>
    </div>
  )
}
