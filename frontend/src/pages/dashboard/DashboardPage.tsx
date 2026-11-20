import { useQuery } from '@tanstack/react-query'
import { Award, Briefcase, Zap, CalendarCheck, Clock, FileText, Search, Send, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AgentHealthCard } from '@/components/dashboard/AgentHealthCard'
import { NextRunBadge } from '@/components/dashboard/NextRunBadge'
import { PipelineCard } from '@/components/dashboard/PipelineCard'
import { RecentActivityCard } from '@/components/dashboard/RecentActivityCard'
import { TodayCard } from '@/components/dashboard/TodayCard'
import { TopMatchesCard } from '@/components/dashboard/TopMatchesCard'
import { DiscoveryRunner } from '@/components/shared/DiscoveryRunner'
import { Card, CardBody, CardHeader, CountUp, ErrorState, Skeleton, StatCard, buttonClasses } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { analyticsService } from '@/services/agent'
import { formatNumber, formatPercent } from '@/utils/format'

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function DashboardPage() {
  const { user } = useAuth()
  const summary = useQuery({ queryKey: ['analytics', 'summary'], queryFn: analyticsService.summary })
  const weekly = useQuery({ queryKey: ['analytics', 'weekly'], queryFn: analyticsService.weekly })
  const t = summary.data?.totals
  const first = user?.full_name?.split(' ')[0]

  const widgets = t
    ? [
        { label: 'Jobs discovered', value: <CountUp value={t.jobs_discovered} />, hint: `${formatNumber(t.active_jobs)} active`, icon: <Search className="h-4 w-4" />, to: '/jobs' },
        { label: 'High-compatibility jobs', value: <CountUp value={t.qualified} />, hint: `Score ≥ ${t.threshold}`, icon: <Sparkles className="h-4 w-4" />, to: '/jobs/recommended' },
        { label: 'Pending approvals', value: <CountUp value={t.pending_approval} />, hint: 'Need your review or input', icon: <Clock className="h-4 w-4" />, to: '/applications?status=awaiting_approval,needs_input' },
        { label: 'Submitted', value: <CountUp value={t.submitted} />, hint: `Response rate ${formatPercent(t.response_rate)}`, icon: <Send className="h-4 w-4" />, to: '/applications?status=submitted' },
        { label: 'Interviews', value: <CountUp value={t.interviews} />, hint: `Interview rate ${formatPercent(t.interview_rate)}`, icon: <CalendarCheck className="h-4 w-4" />, to: '/interviews' },
        { label: 'Offers', value: <CountUp value={t.offers} />, hint: `${formatNumber(t.rejections)} rejection(s)`, icon: <Award className="h-4 w-4" />, to: '/applications?status=offer_received' },
      ]
    : []

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card-surface animate-fade-up relative overflow-hidden rounded-3xl border border-border bg-surface p-6 sm:p-8 lg:col-span-3">
          <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 animate-float rounded-full bg-primary opacity-10 blur-3xl" />
          <div className="relative flex h-full flex-col justify-between gap-6">
            <div className="min-w-0">
              <NextRunBadge className="mb-4" />
              <h1 className="text-3xl font-light tracking-tight text-fg sm:text-4xl">
                {greeting()}
                {first ? (
                  <>
                    , <span className="font-normal text-gradient">{first}</span>
                  </>
                ) : null}
              </h1>
              <p className="mt-2 text-sm text-subtle">
                {t && t.qualified > 0
                  ? `${formatNumber(t.qualified)} strong matches are waiting for you. Your job search at a glance.`
                  : 'Your job search at a glance.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/apply" className={buttonClasses('primary', 'md', 'h-10 px-5 shadow-lg shadow-primary/30')}>
                <Zap className="h-4 w-4" aria-hidden="true" /> Start Apply Mode
              </Link>
              <DiscoveryRunner variant="outline" />
            </div>
          </div>
        </section>
        <div className="animate-fade-up lg:col-span-2">
          <TodayCard />
        </div>
      </div>

      <section aria-label="Key metrics">
        {summary.isPending ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[112px] rounded-2xl" />
            ))}
          </div>
        ) : summary.isError ? (
          <Card>
            <ErrorState error={summary.error} title="Could not load your metrics" onRetry={() => void summary.refetch()} />
          </Card>
        ) : (
          <div className="stagger grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {widgets.map((w) => (
              <Link key={w.label} to={w.to} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-ring">
                <StatCard label={w.label} value={w.value} hint={w.hint} icon={w.icon} className="lift h-full" />
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
          <TopMatchesCard />
        </div>
        {summary.data && <PipelineCard funnel={summary.data.funnel} />}
      </div>

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
