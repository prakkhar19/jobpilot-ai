import { useQuery } from '@tanstack/react-query'
import { Info, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BreakdownTable } from '@/components/analytics/BreakdownTable'
import { ChartTooltip } from '@/components/analytics/ChartTooltip'
import { useChartColors } from '@/components/analytics/useChartColors'
import { ApplicationStatusBadge } from '@/components/shared/StatusBadge'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { analyticsService } from '@/services/agent'
import { APPLICATION_STATUS_LABELS } from '@/utils/constants'
import { formatDate, formatNumber, formatPercent } from '@/utils/format'

function TableToggle({ showTable, onToggle, label }: { showTable: boolean; onToggle: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onToggle} aria-pressed={showTable} aria-label={`${showTable ? 'Show chart' : 'Show table'} for ${label}`}>
      {showTable ? 'Chart' : 'Table'}
    </Button>
  )
}

export default function AnalyticsPage() {
  const summary = useQuery({ queryKey: ['analytics', 'summary'], queryFn: analyticsService.summary })
  const colors = useChartColors()
  const [funnelTable, setFunnelTable] = useState(false)
  const [weeklyTable, setWeeklyTable] = useState(false)

  if (summary.isPending) return <LoadingState label="Loading analytics…" />
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
  const s = summary.data
  const t = s.totals
  const weekly = s.weekly.map((w) => ({ ...w, label: formatDate(w.week).replace(/,? \d{4}$/, '') }))
  const statusEntries = Object.entries(s.status_counts).sort((a, b) => b[1] - a[1])
  const axisProps = { stroke: colors.axis, tick: { fill: colors.axis, fontSize: 12 }, tickLine: false, axisLine: false }

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="How your search is going, computed from your own data on this server." />
      <Alert tone="info" title="Guidance only">
        <span className="inline-flex gap-1.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {s.disclaimer}
        </span>
      </Alert>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Submitted" value={formatNumber(t.submitted)} />
        <StatCard label="Response rate" value={formatPercent(t.response_rate)} hint={`${formatNumber(t.rejections)} rejection(s)`} />
        <StatCard label="Interview rate" value={formatPercent(t.interview_rate)} hint={`${formatNumber(t.interviews)} interviewed`} />
        <StatCard label="Offers" value={formatNumber(t.offers)} />
      </div>

      {s.insights.length > 0 && (
        <Card>
          <CardHeader title="Insights" />
          <CardBody>
            <ul className="space-y-2">
              {s.insights.map((i) => (
                <li key={i} className="flex gap-2 text-sm text-fg">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  {i}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Pipeline funnel"
            description="From discovery to offer."
            actions={<TableToggle showTable={funnelTable} onToggle={() => setFunnelTable((v) => !v)} label="pipeline funnel" />}
          />
          <CardBody>
            {funnelTable ? (
              <table className="w-full text-sm">
                <caption className="sr-only">Pipeline funnel</caption>
                <thead>
                  <tr className="text-left text-xs text-subtle"><th scope="col" className="py-1 font-medium">Stage</th><th scope="col" className="py-1 text-right font-medium">Count</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.funnel.map((f) => (
                    <tr key={f.stage}><th scope="row" className="py-1.5 text-left font-normal text-fg">{f.stage}</th><td className="py-1.5 text-right tabular-nums">{f.count}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <figure aria-label={`Pipeline funnel: ${s.funnel.map((f) => `${f.stage} ${f.count}`).join(', ')}`} className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={s.funnel} layout="vertical" margin={{ left: 8, right: 40 }}>
                    <CartesianGrid horizontal={false} stroke={colors.grid} />
                    <XAxis type="number" allowDecimals={false} {...axisProps} />
                    <YAxis type="category" dataKey="stage" width={84} {...axisProps} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.grid, opacity: 0.4 }} />
                    <Bar dataKey="count" name="Count" fill={colors.series[0]} radius={[0, 4, 4, 0]} barSize={18}>
                      <LabelList dataKey="count" position="right" fill={colors.axis} fontSize={12} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </figure>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Weekly activity"
            description="Last 12 weeks."
            actions={<TableToggle showTable={weeklyTable} onToggle={() => setWeeklyTable((v) => !v)} label="weekly activity" />}
          />
          <CardBody>
            {weeklyTable ? (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm tabular-nums">
                  <caption className="sr-only">Weekly activity</caption>
                  <thead>
                    <tr className="text-left text-xs text-subtle">
                      <th scope="col" className="py-1 font-medium">Week of</th>
                      <th scope="col" className="py-1 text-right font-medium">Discovered</th>
                      <th scope="col" className="py-1 text-right font-medium">Submitted</th>
                      <th scope="col" className="py-1 text-right font-medium">Interviews</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {s.weekly.map((w) => (
                      <tr key={w.week}>
                        <th scope="row" className="py-1.5 text-left font-normal">{formatDate(w.week)}</th>
                        <td className="py-1.5 text-right">{w.discovered}</td>
                        <td className="py-1.5 text-right">{w.submitted}</td>
                        <td className="py-1.5 text-right">{w.interviews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <figure aria-label="Weekly activity line chart of jobs discovered, applications submitted and interviews. Use the Table button for exact values." className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekly} margin={{ left: -16, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} stroke={colors.grid} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: colors.axis }} iconType="plainline" />
                    {(['discovered', 'submitted', 'interviews'] as const).map((k, i) => (
                      <Line
                        key={k}
                        type="monotone"
                        dataKey={k}
                        name={k === 'discovered' ? 'Discovered' : k === 'submitted' ? 'Submitted' : 'Interviews'}
                        stroke={colors.series[i]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </figure>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Breakdown" description="Response and interview rates are relative to submitted applications." />
        <CardBody className="px-0 pt-0">
          <Tabs defaultValue="source" className="px-5 pt-4">
            <TabsList aria-label="Breakdown dimension">
              <TabsTrigger value="source">By source</TabsTrigger>
              <TabsTrigger value="role">By role</TabsTrigger>
              <TabsTrigger value="company">By company</TabsTrigger>
              <TabsTrigger value="resume">By resume version</TabsTrigger>
            </TabsList>
            <div className="-mx-5">
              <TabsContent value="source"><BreakdownTable rows={s.by_source} keyLabel="Source" caption="Breakdown by source" /></TabsContent>
              <TabsContent value="role"><BreakdownTable rows={s.by_role} keyLabel="Role family" caption="Breakdown by role" /></TabsContent>
              <TabsContent value="company"><BreakdownTable rows={s.by_company} keyLabel="Company" caption="Breakdown by company" /></TabsContent>
              <TabsContent value="resume"><BreakdownTable rows={s.by_resume} keyLabel="Template · method" caption="Breakdown by resume version" /></TabsContent>
            </div>
          </Tabs>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Applications by status" />
        <CardBody>
          {statusEntries.length === 0 ? (
            <EmptyState title="No applications yet" description="Track or prepare an application from a job to see it here." className="py-6" />
          ) : (
            <ul className="flex flex-wrap gap-3">
              {statusEntries.map(([k, n]) => (
                <li key={k} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <ApplicationStatusBadge status={k} />
                  <span className="text-sm font-semibold text-fg tabular-nums" aria-label={`${APPLICATION_STATUS_LABELS[k] ?? k}: ${n}`}>{n}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
