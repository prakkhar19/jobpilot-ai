import { useQuery } from '@tanstack/react-query'
import { Award, Briefcase, CalendarCheck, Clock, FileText, Search, Send, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AgentHealthCard } from '@/components/dashboard/AgentHealthCard'
import { RecentActivityCard } from '@/components/dashboard/RecentActivityCard'
import { DiscoveryRunner } from '@/components/shared/DiscoveryRunner'
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatCard, buttonClasses } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { analyticsService } from '@/services/agent'
import { formatNumber, formatPercent } from '@/utils/format'

export default function DashboardPage() {
  const { user } = useAuth()
  const summary = useQuery({ queryKey: ['analytics', 'summary'], queryFn: analyticsService.summary })
  const weekly = useQuery({ queryKey: ['analytics', 'weekly'], queryFn: analyticsService.weekly })
  const t = summary.data?.totals
  const first = user?.full_name?.split(' ')[0]

  const widgets = t
    ? [
        { label: 'Jobs discovered', value: formatNumber(t.jobs_discovered), hint: `${formatNumber(t.active_jobs)} active`, icon: <Search className="h-4 w-4" />, to: '/jobs' },
        { label: 'High-compatibility jobs', value: formatNumber(t.qualified), hint: `Score ≥ ${t.threshold}`, icon: <Sparkles className="h-4 w-4" />, to: '/jobs/recommended' },
        { label: 'Pending approvals', value: formatNumber(t.pending_approval), hint: 'Need your review or input', icon: <Clock className="h-4 w-4" />, to: '/applications?status=awaiting_approval,needs_input' },
        { label: 'Submitted', value: formatNumber(t.submitted), hint: `Response rate ${formatPercent(t.response_rate)}`, icon: <Send className="h-4 w-4" />, to: '/applications?status=submitted' },
        { label: 'Interviews', value: formatNumber(t.interviews), hint: `Interview rate ${formatPercent(t.interview_rate)}`, icon: <CalendarCheck className="h-4 w-4" />, to: '/interviews' },
        { label: 'Offers', value: formatNumber(t.offers), hint: `${formatNumber(t.rejections)} rejection(s)`, icon: <Award className="h-4 w-4" />, to: '/applications?status=offer_received' },
      ]
    : []

  return (
    <div className="space-y-6">
      <PageHeader
        title={first ? `Welcome back, ${first}` : 'Dashboard'}
        description="Your job search at a glance."
        actions={<DiscoveryRunner />}
      />

      <section aria-label="Key metrics">
        {summary.isPending ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-xl" />
            ))}
          </div>
        ) : summary.isError ? (
          <Card>
            <ErrorState error={summary.error} title="Could not load your metrics" onRetry={() => void summary.refetch()} />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {widgets.map((w) => (
              <Link key={w.label} to={w.to} className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <StatCard label={w.label} value={w.value} hint={w.hint} icon={w.icon} className="h-full transition-colors hover:border-border-strong" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {weekly.data?.text && (
        <Card>
          <CardBody className="text-sm text-muted">
            <span className="font-medium text-fg">This week: </span>
            {weekly.data.text}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivityCard />
        </div>
        <div className="space-y-6">
          <AgentHealthCard />
          <Card>
            <CardHeader title="Quick actions" />
            <CardBody className="grid gap-2">
              <Link to="/jobs/recommended" className={buttonClasses('outline', 'md', 'justify-start')}>
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Review recommended jobs
              </Link>
              <Link to="/applications?status=awaiting_approval,needs_input" className={buttonClasses('outline', 'md', 'justify-start')}>
                <Briefcase className="h-4 w-4" aria-hidden="true" /> Pending approvals
                {t && t.pending_approval > 0 ? ` (${t.pending_approval})` : ''}
              </Link>
              <Link to="/resumes" className={buttonClasses('outline', 'md', 'justify-start')}>
                <FileText className="h-4 w-4" aria-hidden="true" /> Open Resume Studio
              </Link>
              <Link to="/integrations" className={buttonClasses('outline', 'md', 'justify-start')}>
                <Search className="h-4 w-4" aria-hidden="true" /> Manage job sources
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
      {summary.data?.disclaimer && <p className="text-xs text-subtle">{summary.data.disclaimer}</p>}
    </div>
  )
}
