import { useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkCheck, Building2, MapPin } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ApplicationStatusBadge } from '@/components/shared/StatusBadge'
import { Badge, Button, ScoreBadge } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { jobService } from '@/services/jobs'
import type { Job } from '@/types/api'
import { RECOMMENDATION_LABELS, recommendationTone, SOURCE_KIND_LABELS, WORKPLACE_LABELS } from '@/utils/constants'
import { formatRelative, formatSalary, humanize } from '@/utils/format'

export function JobRow({ job }: { job: Job }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)

  const toggleSave = async () => {
    setSaving(true)
    try {
      if (job.saved) await jobService.unsave(job.id)
      else await jobService.save(job.id)
      toast.success(job.saved ? 'Removed from saved jobs' : 'Saved')
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (err) {
      toast.error('Could not update saved jobs', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const salary = formatSalary(job)
  const rec = job.recommendation as keyof typeof RECOMMENDATION_LABELS | null | undefined
  return (
    <li className="flex items-start gap-4 px-4 py-4 hover:bg-surface-2/60 sm:px-5">
      <ScoreBadge score={job.match_score} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/jobs/${job.id}`} className="font-medium text-fg hover:text-primary hover:underline">
            {job.title}
          </Link>
          {rec && <Badge tone={recommendationTone(rec)}>{RECOMMENDATION_LABELS[rec] ?? humanize(rec)}</Badge>}
          {job.application_status && <ApplicationStatusBadge status={job.application_status} />}
          {job.is_demo && <Badge tone="warning">Demo</Badge>}
          {job.status === 'expired' && <Badge tone="danger">Expired</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            {job.company}
          </span>
          {job.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {job.location}
            </span>
          )}
          {job.workplace_type && job.workplace_type !== 'unknown' && <span>{WORKPLACE_LABELS[job.workplace_type] ?? job.workplace_type}</span>}
          {salary && <span>{salary}</span>}
          <span>{SOURCE_KIND_LABELS[job.source_kind] ?? humanize(job.source_kind)}</span>
          <span>Found {formatRelative(job.discovered_at)}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggleSave}
        loading={saving}
        aria-pressed={!!job.saved}
        aria-label={job.saved ? `Unsave ${job.title}` : `Save ${job.title}`}
        title={job.saved ? 'Unsave' : 'Save'}
      >
        {!saving && (job.saved ? <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />)}
      </Button>
    </li>
  )
}
