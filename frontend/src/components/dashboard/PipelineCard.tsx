import { Card, CardBody, CardHeader, CountUp } from '@/components/ui'
import type { AnalyticsSummary } from '@/types/api'

const COLORS = ['var(--primary)', 'color-mix(in srgb, var(--primary) 70%, var(--accent))', 'color-mix(in srgb, var(--primary) 40%, var(--accent))', 'var(--accent)', 'color-mix(in srgb, var(--accent) 50%, var(--accent-2))', 'var(--accent-2)']

/** Funnel from discovered jobs to offers. Log-scaled so small stages stay visible next to thousands of jobs. */
export function PipelineCard({ funnel }: { funnel: AnalyticsSummary['funnel'] }) {
  const max = Math.max(1, ...funnel.map((f) => f.count))
  const width = (n: number) => (n <= 0 ? 0 : Math.max(6, (Math.log10(n + 1) / Math.log10(max + 1)) * 100))
  return (
    <Card>
      <CardHeader title="Your pipeline" description="From discovered jobs to offers." />
      <CardBody>
        <ol className="stagger space-y-3">
          {funnel.map((f, i) => (
            <li key={f.stage}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium text-muted">{f.stage}</span>
                <span className="font-semibold text-fg tabular-nums">
                  <CountUp value={f.count} />
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-out"
                  style={{ width: `${width(f.count)}%`, background: COLORS[i % COLORS.length] }}
                />
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}
