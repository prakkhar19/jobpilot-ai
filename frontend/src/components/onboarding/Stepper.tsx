import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Setup progress">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((label, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                  done && 'bg-primary text-primary-fg',
                  active && 'bg-primary-soft text-primary ring-2 ring-primary',
                  !done && !active && 'bg-surface-2 text-subtle',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn('text-xs font-medium', active ? 'text-fg' : 'hidden text-subtle sm:inline')}>
                {label}
                {done && <span className="sr-only"> (completed)</span>}
              </span>
              {i < steps.length - 1 && <span className="hidden h-px w-6 bg-border sm:block" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
