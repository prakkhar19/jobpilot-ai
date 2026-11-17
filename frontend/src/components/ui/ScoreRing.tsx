import { cn } from '@/utils/cn'
import { scoreTone } from '@/utils/constants'

const TONE_STROKE: Record<string, string> = {
  neutral: 'stroke-subtle',
  primary: 'stroke-primary',
  success: 'stroke-success',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
  info: 'stroke-info',
}

/** Circular match score. Same accessible text as ScoreBadge. */
export function ScoreRing({ score, size = 44, className }: { score: number | null | undefined; size?: number; className?: string }) {
  const known = score !== null && score !== undefined
  const v = known ? Math.max(0, Math.min(100, score)) : 0
  const stroke = Math.max(3, Math.round(size / 11))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      title={known ? `Match score ${Math.round(v)} of 100` : 'Not matched yet'}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
        {known && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className={cn(TONE_STROKE[scoreTone(score)], 'transition-[stroke-dashoffset] duration-700 ease-out')}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v / 100)}
          />
        )}
      </svg>
      <span className="absolute text-xs font-semibold text-fg tabular-nums" style={{ fontSize: Math.max(10, size / 3.6) }}>
        {known ? Math.round(v) : '—'}
        <span className="sr-only"> match score</span>
      </span>
    </span>
  )
}
