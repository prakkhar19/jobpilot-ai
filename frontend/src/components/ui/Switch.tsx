import * as RS from '@radix-ui/react-switch'
import * as RC from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface ToggleProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
}

export function Switch({ checked, onCheckedChange, label, description, disabled, id, className }: ToggleProps) {
  const auto = useId()
  const sid = id ?? auto
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={sid} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description && (
          <p id={`${sid}-desc`} className="mt-0.5 text-xs text-subtle">
            {description}
          </p>
        )}
      </div>
      <RS.Root
        id={sid}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${sid}-desc` : undefined}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors',
          'bg-border-strong data-[state=checked]:bg-primary disabled:opacity-50',
        )}
      >
        <RS.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[1.05rem]" />
      </RS.Root>
    </div>
  )
}

export function Checkbox({ checked, onCheckedChange, label, description, disabled, id, className }: ToggleProps) {
  const auto = useId()
  const cid = id ?? auto
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <RC.Root
        id={cid}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        aria-describedby={description ? `${cid}-desc` : undefined}
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border-strong bg-surface',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50',
        )}
      >
        <RC.Indicator>
          <Check className="h-3 w-3 text-primary-fg" strokeWidth={3} aria-hidden="true" />
        </RC.Indicator>
      </RC.Root>
      <div className="min-w-0">
        <label htmlFor={cid} className="text-sm text-fg">
          {label}
        </label>
        {description && (
          <p id={`${cid}-desc`} className="text-xs text-subtle">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
