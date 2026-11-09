import { useId } from 'react'
import { Button } from '@/components/ui'
import { normalizedPercents, WEIGHT_LABELS } from './weights'
import { humanize } from '@/utils/format'

export function WeightSliders({
  value,
  onChange,
  defaults,
}: {
  value: Record<string, number>
  onChange: (v: Record<string, number>) => void
  defaults: Record<string, number>
}) {
  const base = useId()
  const pct = normalizedPercents(value)
  const allZero = Object.values(value).every((v) => v <= 0)
  return (
    <div className="space-y-4">
      {Object.keys(value).map((key) => {
        const id = `${base}-${key}`
        return (
          <div key={key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[12rem_1fr_4.5rem]">
            <label htmlFor={id} className="text-sm text-fg">
              {WEIGHT_LABELS[key] ?? humanize(key)}
            </label>
            <input
              id={id}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
              aria-valuetext={`${pct[key].toFixed(0)} percent of the total score`}
              className="w-full accent-[var(--primary)]"
            />
            <span className="text-right text-sm font-medium text-fg tabular-nums" aria-hidden="true">
              {pct[key].toFixed(1)}%
            </span>
          </div>
        )
      })}
      {allZero && <p className="text-xs text-danger">At least one weight must be above zero.</p>}
      <div className="flex items-center justify-between gap-2 text-xs text-subtle">
        <span>Percentages are normalised live so they always add up to 100%.</span>
        <Button variant="ghost" size="sm" onClick={() => onChange({ ...defaults })}>
          Reset to defaults
        </Button>
      </div>
    </div>
  )
}
