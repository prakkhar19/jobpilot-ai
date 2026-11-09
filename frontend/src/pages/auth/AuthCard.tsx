import type { ReactNode } from 'react'

export function AuthCard({ title, description, children, footer }: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-subtle">{description}</p>}
      </div>
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">{children}</div>
      {footer && <div className="mt-5 text-center text-sm text-subtle">{footer}</div>}
    </div>
  )
}
