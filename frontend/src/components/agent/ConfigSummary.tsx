import { Link } from 'react-router-dom'
import { Badge, Card, CardBody, CardHeader, DefinitionList, ErrorState, LoadingState } from '@/components/ui'
import type { AgentConfig } from '@/types/api'
import { WEEKDAYS } from '@/utils/constants'
import { formatDate, humanize } from '@/utils/format'

const MODE_LABELS: Record<string, string> = {
  review: 'Review (you submit)',
  assisted: 'Assisted (pre-fill only)',
  authorized: 'Authorized automation',
}

export function ConfigSummary({ config, error, loading, onRetry }: {
  config?: AgentConfig
  error: unknown
  loading: boolean
  onRetry: () => void
}) {
  return (
    <Card>
      <CardHeader
        title="Current configuration"
        actions={<Link to="/settings" className="text-xs text-primary hover:underline">Edit in Settings</Link>}
      />
      <CardBody>
        {loading ? (
          <LoadingState />
        ) : error || !config ? (
          <ErrorState error={error} onRetry={onRetry} className="py-4" />
        ) : (
          <DefinitionList
            className="sm:grid-cols-1 xl:grid-cols-2"
            items={[
              [
                'Schedule',
                <span key="s" className="flex flex-wrap items-center gap-1.5">
                  {config.paused ? <Badge tone="warning">Paused</Badge> : config.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Manual only</Badge>}
                  <span>
                    every {config.frequency_hours}h · {config.run_days.map((d) => WEEKDAYS[d] ?? d).join(', ') || 'no days'} ·{' '}
                    {config.window_start_hour}:00–{config.window_end_hour}:00 {config.timezone}
                  </span>
                </span>,
              ],
              ['Last run', formatDate(config.last_run_at, true)],
              ['Next run', config.paused || !config.enabled ? '—' : formatDate(config.next_run_at, true)],
              ['Target roles', config.target_roles.join(', ') || 'Any'],
              ['Locations', [...config.locations, ...config.workplace_types.map(humanize)].join(', ') || 'Any'],
              ['Minimum match score', String(config.min_match_score)],
              ['Application mode', MODE_LABELS[config.application_mode] ?? config.application_mode],
              [
                'Automation',
                [
                  config.auto_generate_documents ? 'auto-generate documents' : null,
                  config.auto_prepare_applications ? 'auto-prepare applications' : null,
                  config.use_llm ? 'AI enabled' : 'AI disabled',
                ]
                  .filter(Boolean)
                  .join(' · '),
              ],
              ['Daily limits', `${config.daily_discovery_limit} jobs · ${config.max_preparations_per_day} preparations`],
            ]}
          />
        )}
      </CardBody>
    </Card>
  )
}
