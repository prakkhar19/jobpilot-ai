import { Plane } from 'lucide-react'
import { cn } from '@/utils/cn'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight text-fg', className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-fg">
        <Plane className="h-4 w-4 -rotate-45" aria-hidden="true" />
      </span>
      <span>
        JobPilot <span className="text-primary">AI</span>
      </span>
    </span>
  )
}
