import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Building2, MapPin, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardHeader, ScoreRing, Skeleton } from '@/components/ui'
import { jobService } from '@/services/jobs'
import { formatRelative } from '@/utils/format'

export function TopMatchesCard() {
  const jobs = useQuery({
    queryKey: ['jobs', 'list', { view: 'recommended', sort: 'score', page_size: 6 }],
    queryFn: () => jobService.list({ view: 'recommended', sort: 'score', page: 1, page_size: 6 }),
  })
  if (jobs.isError) return null
  const items = jobs.data?.items ?? []
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" /> Top matches for you
          </span>
        }
        description="Your best-scoring open jobs right now."
        actions={
          <Link to="/jobs/recommended" className="group inline-flex items-center gap-1 text-xs font-medium text-primary">
            See all <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        }
      />
      {jobs.isPending ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-subtle">No strong matches yet. The agent keeps searching in the background.</p>
      ) : (
        <ul className="stagger grid gap-3 p-4 sm:grid-cols-2">
          {items.map((job) => (
            <li key={job.id}>
              <Link
                to={`/jobs/${job.id}`}
                className="lift flex items-center gap-3 rounded-lg border border-border bg-surface p-3 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ScoreRing score={job.match_score} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{job.title}</span>
                  <span className="mt-0.5 flex items-center gap-3 text-xs text-subtle">
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{job.company}</span>
                    </span>
                    {job.location && (
                      <span className="hidden min-w-0 items-center gap-1 sm:inline-flex">
                        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{job.location}</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-subtle">Found {formatRelative(job.discovered_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
