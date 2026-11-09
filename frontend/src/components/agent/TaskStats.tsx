import { humanize } from '@/utils/format'

/** Renders the free-form AgentTask.stats object as compact key/value chips. */
export function TaskStats({ stats }: { stats: Record<string, unknown> }) {
  const entries: [string, string][] = []
  for (const [k, v] of Object.entries(stats ?? {})) {
    if (k === 'source_ids') continue
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (Array.isArray(v2)) {
          if (v2.length) entries.push([`${humanize(k2)}`, String(v2.length)])
        } else if (v2 !== null && v2 !== undefined) entries.push([humanize(k2), String(v2)])
      }
    } else if (Array.isArray(v)) {
      if (v.length) entries.push([humanize(k), String(v.length)])
    } else if (v !== null && v !== undefined && v !== '') entries.push([humanize(k), String(v)])
  }
  if (!entries.length) return <span className="text-xs text-subtle">No stats</span>
  return (
    <dl className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs">
          <dt className="text-subtle">{k}</dt>
          <dd className="font-medium text-fg tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
