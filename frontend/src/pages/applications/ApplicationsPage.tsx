import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Briefcase, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { canDeleteApplication } from '@/components/applications/helpers'
import { ApplicationStatusBadge } from '@/components/shared/StatusBadge'
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  ScoreBadge,
  buttonClasses,
} from '@/components/ui'
import { useDebounce } from '@/hooks/useDebounce'
import { useMutationToast } from '@/hooks/useMutationToast'
import { applicationService } from '@/services/applications'
import type { Application } from '@/types/api'
import { cn } from '@/utils/cn'
import { APPLICATION_STATUS_LABELS } from '@/utils/constants'
import { formatDate, formatRelative } from '@/utils/format'

const PAGE_SIZE = 25

export default function ApplicationsPage() {
  const [params, setParams] = useSearchParams()
  const statusParam = params.get('status') ?? ''
  const selected = useMemo(() => statusParam.split(',').filter(Boolean), [statusParam])
  const [search, setSearch] = useState(params.get('q') ?? '')
  const q = useDebounce(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [toDelete, setToDelete] = useState<Application | null>(null)

  const statuses = useQuery({ queryKey: ['applications', 'statuses'], queryFn: applicationService.statuses, staleTime: 300_000 })
  const list = useQuery({
    queryKey: ['applications', 'list', statusParam, q, page],
    queryFn: () => applicationService.list({ status: statusParam, q, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  const del = useMutationToast({
    mutationFn: (id: string) => applicationService.remove(id),
    success: 'Application deleted',
    error: 'Could not delete application',
    invalidate: [['applications'], ['analytics'], ['jobs']],
    onSuccess: () => setToDelete(null),
  })

  const setStatusFilter = (keys: string[]) => {
    const next = new URLSearchParams(params)
    if (keys.length) next.set('status', keys.join(','))
    else next.delete('status')
    setParams(next, { replace: true })
    setPage(1)
  }
  const toggle = (key: string) =>
    setStatusFilter(selected.includes(key) ? selected.filter((s) => s !== key) : [...selected, key])

  const statusOptions = statuses.data?.statuses ?? Object.entries(APPLICATION_STATUS_LABELS).map(([key, label]) => ({ key, label }))
  const items = list.data?.items ?? []
  const filtered = !!statusParam || !!q

  return (
    <div>
      <PageHeader
        title="Applications"
        description="Every job you are tracking, preparing or have applied to — from shortlist to offer."
        actions={
          <Link to="/jobs/recommended" className={buttonClasses('outline')}>
            Find jobs to apply to
          </Link>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search applications by company or title"
            placeholder="Search company or job title…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-9"
          />
        </div>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={selected.length === 0}
            onClick={() => setStatusFilter([])}
            className={chipClass(selected.length === 0)}
          >
            All
          </button>
          {statusOptions.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={selected.includes(s.key)}
              onClick={() => toggle(s.key)}
              className={chipClass(selected.includes(s.key))}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {list.isPending ? (
          <LoadingState label="Loading applications…" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-5 w-5" aria-hidden="true" />}
            title={filtered ? 'No applications match these filters' : 'No applications yet'}
            description={
              filtered
                ? 'Try a different search or clear the status filters.'
                : 'Track or prepare an application from any job to see it here.'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={() => { setSearch(''); setStatusFilter([]) }}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/jobs" className={buttonClasses('primary')}>
                  Browse jobs
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-subtle">
                    <th scope="col" className="px-4 py-2.5 font-medium">Job</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Match</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Mode</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Follow-up</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Updated</th>
                    <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-3">
                        <Link to={`/applications/${a.id}`} className="font-medium text-fg hover:text-primary hover:underline">
                          {a.job_title || 'Untitled job'}
                        </Link>
                        <div className="text-xs text-subtle">{a.company}</div>
                      </td>
                      <td className="px-4 py-3">
                        <ApplicationStatusBadge status={a.status} />
                        {a.busy && <span className="ml-2 text-xs text-subtle">working…</span>}
                      </td>
                      <td className="px-4 py-3"><ScoreBadge score={a.match_score} /></td>
                      <td className="px-4 py-3 text-muted capitalize">{a.mode}</td>
                      <td className="px-4 py-3 text-muted">{a.follow_up_date ? formatDate(a.follow_up_date) : '—'}</td>
                      <td className="px-4 py-3 text-muted">{formatRelative(a.updated_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {canDeleteApplication(a) && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete application for ${a.job_title} at ${a.company}`}
                            onClick={() => setToDelete(a)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {items.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <ScoreBadge score={a.match_score} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/applications/${a.id}`} className="block truncate font-medium text-fg hover:text-primary">
                      {a.job_title || 'Untitled job'}
                    </Link>
                    <p className="truncate text-xs text-subtle">{a.company}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-subtle">
                      <ApplicationStatusBadge status={a.status} />
                      <span>{formatRelative(a.updated_at)}</span>
                    </div>
                  </div>
                  {canDeleteApplication(a) && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete application for ${a.job_title}`} onClick={() => setToDelete(a)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {list.data && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPageChange={setPage} />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this application?"
        description={
          toDelete
            ? `${toDelete.job_title} at ${toDelete.company} will be removed from your tracker, including its history. The job itself stays.`
            : undefined
        }
        destructive
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  )
}

function chipClass(active: boolean): string {
  return cn(
    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
    active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted hover:bg-surface-2 hover:text-fg',
  )
}
