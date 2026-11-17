import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { agentService } from '@/services/agent'
import { cn } from '@/utils/cn'

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Live "next search in 7:32" pill with a pulsing status dot. */
export function NextRunBadge({ className }: { className?: string }) {
  const config = useQuery({ queryKey: ['agent', 'config'], queryFn: agentService.config, refetchInterval: 60_000 })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const cfg = config.data
  if (!cfg) return null

  const off = !cfg.enabled || cfg.paused
  const next = cfg.next_run_at ? new Date(cfg.next_run_at).getTime() - now : null
  const label = off ? 'Agent paused' : next === null ? 'Waiting for first search' : next <= 0 ? 'Searching now…' : `Next search in ${fmt(next)}`
  const dot = off ? 'bg-subtle' : next !== null && next <= 0 ? 'bg-primary' : 'bg-success'
  return (
    <span
      className={cn('glass inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted tabular-nums', className)}
      aria-live="off"
    >
      <span className="relative flex h-2 w-2">
        {!off && <span className={cn('absolute inline-flex h-full w-full animate-ping-slow rounded-full', dot)} />}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', dot)} />
      </span>
      {label}
    </span>
  )
}
