import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileInput, RefreshCw, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ImportJobDialog } from '@/components/jobs/ImportJobDialog'
import { JobRow } from '@/components/jobs/JobRow'
import { DiscoveryRunner } from '@/components/shared/DiscoveryRunner'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  buttonClasses,
} from '@/components/ui'
import { useDebounce } from '@/hooks/useDebounce'
import { useMutationToast } from '@/hooks/useMutationToast'
import { jobService } from '@/services/jobs'
import type { JobSort, JobView } from '@/types/api'
import { SOURCE_KIND_LABELS } from '@/utils/constants'

const PAGE_SIZE = 20

const TITLES: Record<string, { title: string; description: string }> = {
  all: { title: 'Discover Jobs', description: 'Every job found by the agent or imported by you, matched against your profile.' },
  recommended: { title: 'Recommended Jobs', description: 'Jobs that meet your minimum match score, best first.' },
  saved: { title: 'Saved Jobs', description: 'Jobs you bookmarked for later.' },
}

export default function JobsPage({ view }: { view: JobView }) {
  const [params, setParams] = useSearchParams()
  const [importOpen, setImportOpen] = useState(false)
  const [q, setQ] = useState(params.get('q') ?? '')
  const debouncedQ = useDebounce(q, 350)
  const source_kind = params.get('source') ?? ''
  const workplace_type = params.get('workplace') ?? ''
  const minScoreRaw = params.get('min_score') ?? ''
  const sort = (params.get('sort') as JobSort | null) ?? (view === 'recommended' ? 'score' : 'newest')
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const update = (patch: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (resetPage && !('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if ((params.get('q') ?? '') !== debouncedQ) update({ q: debouncedQ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ])

  const query = {
    view,
    q: params.get('q') ?? '',
    source_kind,
    workplace_type,
    min_score: minScoreRaw ? Number(minScoreRaw) : null,
    sort,
    page,
    page_size: PAGE_SIZE,
  }
  const jobs = useQuery({ queryKey: ['jobs', 'list', query], queryFn: () => jobService.list(query), placeholderData: keepPreviousData })

  const rematch = useMutationToast({
    mutationFn: () => jobService.rematchAll(),
    success: (d) => `Re-matched ${d.matched} job(s)`,
    error: 'Re-matching failed',
    invalidate: [['jobs']],
  })

  const filtersActive = !!(query.q || source_kind || workplace_type || minScoreRaw)
  const meta = TITLES[view] ?? TITLES.all

  return (
    <div>
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileInput className="h-4 w-4" aria-hidden="true" /> Import job
            </Button>
            <Button variant="outline" onClick={() => rematch.mutate()} loading={rematch.isPending}>
              {!rematch.isPending && <RefreshCw className="h-4 w-4" aria-hidden="true" />} Re-match all
            </Button>
          </>
        }
      />
      <div className="mb-4">
        <DiscoveryRunner />
      </div>
      <Card>
        <form
          role="search"
          aria-label="Filter jobs"
          onSubmit={(e) => e.preventDefault()}
          className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <Field label="Search" className="lg:col-span-2">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, company or location" />
          </Field>
          <Field label="Source">
            <Select value={source_kind} onChange={(e) => update({ source: e.target.value })}>
              <option value="">All sources</option>
              {['greenhouse', 'lever', 'ashby', 'career_page', 'demo', 'manual'].map((k) => (
                <option key={k} value={k}>
                  {SOURCE_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Workplace">
            <Select value={workplace_type} onChange={(e) => update({ workplace: e.target.value })}>
              <option value="">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
              <option value="unknown">Unspecified</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min score">
              <Select value={minScoreRaw} onChange={(e) => update({ min_score: e.target.value })}>
                <option value="">Any</option>
                {[40, 50, 60, 70, 80, 90].map((s) => (
                  <option key={s} value={s}>
                    {s}+
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort by">
              <Select value={sort} onChange={(e) => update({ sort: e.target.value })}>
                <option value="newest">Newest</option>
                <option value="score">Best match</option>
                <option value="company">Company</option>
                <option value="title">Title</option>
              </Select>
            </Field>
          </div>
        </form>
        {jobs.isPending ? (
          <LoadingState label="Loading jobs…" />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} title="Could not load jobs" onRetry={() => void jobs.refetch()} />
        ) : jobs.data.items.length === 0 ? (
          filtersActive ? (
            <EmptyState
              icon={<SearchX className="h-5 w-5" aria-hidden="true" />}
              title="No jobs match these filters"
              action={
                <Button variant="outline" size="sm" onClick={() => { setQ(''); setParams(new URLSearchParams(), { replace: true }) }}>
                  Clear filters
                </Button>
              }
            />
          ) : view === 'saved' ? (
            <EmptyState title="No saved jobs yet" description="Bookmark jobs from the job list to keep them here." action={<Link className={buttonClasses('outline', 'sm')} to="/jobs">Browse jobs</Link>} />
          ) : view === 'recommended' ? (
            <EmptyState
              title="No recommended jobs yet"
              description="Recommended jobs meet your minimum match score. Run discovery, approve your profile, or lower the threshold in Settings."
              action={<Link className={buttonClasses('outline', 'sm')} to="/settings">Open settings</Link>}
            />
          ) : (
            <EmptyState
              title="No jobs yet"
              description="Add job sources in Integrations and run discovery, or import a posting manually."
              action={
                <>
                  <Link className={buttonClasses('outline', 'sm')} to="/integrations">Add sources</Link>
                  <Button size="sm" onClick={() => setImportOpen(true)}>Import job</Button>
                </>
              }
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-border" aria-label="Jobs" aria-busy={jobs.isFetching}>
              {jobs.data.items.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
            <div className="px-4 pb-4">
              <Pagination page={page} pageSize={PAGE_SIZE} total={jobs.data.total} onPageChange={(p) => update({ page: String(p) }, false)} />
            </div>
          </>
        )}
      </Card>
      <ImportJobDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
