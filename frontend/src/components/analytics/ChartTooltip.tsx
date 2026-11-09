interface Entry {
  name?: string | number
  value?: number | string | (number | string)[]
  color?: string
  dataKey?: string | number
}

export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Entry[]; label?: string | number }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-medium text-fg">{label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            <span>{p.name}</span>
            <span className="ml-auto pl-3 font-medium text-fg tabular-nums">{String(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
