import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, LoadingState, SectionTitle } from '@/components/ui'
import { systemService } from '@/services/agent'
import type { Diagnostics } from '@/types/api'
import type { Tone } from '@/utils/constants'
import { SOURCE_KIND_LABELS } from '@/utils/constants'
import { formatDate, formatRelative, humanize } from '@/utils/format'

function checkTone(status: string | undefined): Tone {
  if (status === 'ok') return 'success'
  if (status === 'error') return 'danger'
  if (status === 'stale') return 'warning'
  return 'neutral'
}

function CheckRow({ name, check }: { name: string; check: NonNullable<Diagnostics['checks'][string]> }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="text-sm font-medium text-fg">{humanize(name)}</span>
      <span className="flex items-center gap-2 text-xs text-subtle">
        {'last_seen_at' in check && (
          <span>{check.last_seen_at ? `Last heartbeat ${formatRelative(check.last_seen_at)}` : 'No heartbeat recorded'}</span>
        )}
        {check.detail && <span>{check.detail}</span>}
        <Badge tone={checkTone(check.status)}>{humanize(check.status)}</Badge>
      </span>
    </li>
  )
}

export function DiagnosticsPanel() {
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: systemService.diagnostics,
  })
  return (
    <Card>
      <CardHeader
        title="Diagnostics"
        description="Health of this installation and of your connectors."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} loading={isFetching && !isPending}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </Button>
        }
      />
      <CardBody>
        {isPending && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="diag-services">
              <SectionTitle>
                <span id="diag-services">Services</span>
              </SectionTitle>
              <ul className="mt-2 divide-y divide-border">
                {Object.entries(data.checks).map(([name, check]) =>
                  check ? <CheckRow key={name} name={name} check={check} /> : null,
                )}
              </ul>
              <p className="mt-2 text-xs text-subtle">
                Version {data.version} · {data.environment} · Python {data.python} · Max upload {data.settings.max_upload_mb} MB
                {data.settings.demo_mode ? ' · Demo mode' : ''}
                {data.settings.single_user_mode ? ' · Single-user mode' : ''}
                {data.settings.cookie_secure ? '' : ' · Cookies not marked Secure (use HTTPS in production)'}
              </p>
            </section>

            <section aria-labelledby="diag-failures">
              <SectionTitle>
                <span id="diag-failures">Recent agent failures (7 days)</span>
              </SectionTitle>
              {data.recent_failures.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">No failed runs.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.recent_failures.map((f) => (
                    <li key={f.id} className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
                      <span className="block text-xs text-subtle">{formatDate(f.created_at, true)}</span>
                      <span className="break-words text-fg">{f.error || 'Unknown error'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="diag-connectors">
              <SectionTitle>
                <span id="diag-connectors">Job source connectors</span>
              </SectionTitle>
              {data.connectors.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">No job sources configured.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {data.connectors.map((c) => (
                    <li key={c.id} className="py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-fg">
                          {c.name} <span className="font-normal text-subtle">· {SOURCE_KIND_LABELS[c.kind] ?? c.kind}</span>
                        </span>
                        <span className="flex gap-1.5">
                          {!c.enabled && <Badge>Disabled</Badge>}
                          <Badge tone={c.last_status === 'ok' ? 'success' : c.last_error ? 'danger' : 'neutral'}>
                            {c.last_status ? humanize(c.last_status) : 'Never checked'}
                          </Badge>
                        </span>
                      </div>
                      {c.last_error && <p className="mt-1 text-xs break-words text-danger">{c.last_error}</p>}
                      <p className="text-xs text-subtle">Last checked {formatRelative(c.last_checked_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="diag-ai">
              <SectionTitle>
                <span id="diag-ai">AI providers</span>
              </SectionTitle>
              {data.ai_providers.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">No AI provider configured — deterministic, non-AI features still work.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {data.ai_providers.map((p) => (
                    <li key={p.id} className="py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-fg">
                          {p.name} <span className="font-normal text-subtle">· {p.model}</span>
                        </span>
                        <span className="flex gap-1.5">
                          {!p.enabled && <Badge>Disabled</Badge>}
                          <Badge tone={p.errors ? 'warning' : 'success'}>{p.errors} error(s)</Badge>
                        </span>
                      </div>
                      {p.last_error && <p className="mt-1 text-xs break-words text-danger">{p.last_error}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="diag-apps">
              <SectionTitle>
                <span id="diag-apps">Application integrations</span>
              </SectionTitle>
              <ul className="mt-2 divide-y divide-border">
                {data.application_providers.map((p) => (
                  <li key={p.key} className="py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-fg">{p.label}</span>
                      <span className="flex flex-wrap gap-1.5">
                        <Badge tone={p.inspection ? 'success' : 'neutral'}>Form reading {p.inspection ? 'yes' : 'no'}</Badge>
                        <Badge tone={p.assisted_fill ? 'success' : 'neutral'}>Assisted fill {p.assisted_fill ? 'yes' : 'no'}</Badge>
                        <Badge tone={p.automated_submit ? 'success' : 'neutral'}>Auto-submit {p.automated_submit ? 'yes' : 'no'}</Badge>
                      </span>
                    </div>
                    {p.note && <p className="mt-1 text-xs text-subtle">{p.note}</p>}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="diag-unsupported">
              <SectionTitle>
                <span id="diag-unsupported">Unsupported platforms</span>
              </SectionTitle>
              <ul className="mt-2 divide-y divide-border">
                {data.unsupported_platforms.map((u) => (
                  <li key={u.platform} className="py-2 text-sm">
                    <span className="font-medium text-fg">{humanize(u.platform)}</span>
                    <p className="text-xs text-subtle">{u.reason}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
