import type { ReactNode } from 'react'
import { Card } from '@/components/ui'

export function StepFrame({ title, description, children, footer }: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <Card>
      <div className="border-b border-border px-6 py-5">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-4">{footer}</div>
    </Card>
  )
}
