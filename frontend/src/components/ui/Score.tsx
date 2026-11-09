import { cn } from '@/utils/cn'
import { scoreTone } from '@/utils/constants'
import { toneBar, toneClasses } from './variants'

export function ScoreBadge({ score, className }: { score: number | null | undefined; className?: string }) {
  const tone = scoreTone(score)
  return (
    <span
      className={cn(
        'inline-flex h-7 min-w-[2.75rem] items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
      title={score === null || score === undefined ? 'Not matched yet' : `Match score ${Math.round(score)} of 100`}
    >
      {score === null || score === undefined ? '—' : Math.round(score)}
      <span className="sr-only"> match score</span>
    </span>
  )
}

export function ScoreBar({
  value,
  label,
  className,
}: {
  value: number | null | undefined
  label: string
  className?: string
}) {
  const v = value ?? 0
  const tone = scoreTone(value)
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null || value === undefined ? 'Unknown' : `${Math.round(v)} of 100`}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width]', value === null || value === undefined ? 'bg-transparent' : toneBar[tone])}
        style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
      />
    </div>
  )
}
