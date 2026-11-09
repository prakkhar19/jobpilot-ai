import { CheckCircle2, XCircle } from 'lucide-react'
import { Alert, Badge, Chip, EmptyState, SectionTitle } from '@/components/ui'
import type { ChangeLogEntry, KeywordReport, ResumeContent, ResumeFactCheck } from '@/types/api'
import { humanize } from '@/utils/format'

export function ChangeLogList({ entries }: { entries: ChangeLogEntry[] }) {
  if (!entries.length)
    return <EmptyState title="No changes" description="This version uses your profile content as-is (no job-specific tailoring)." />
  return (
    <ol className="space-y-3">
      {entries.map((c, i) => (
        <li key={i} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{humanize(c.section)}</Badge>
            <Badge>{humanize(c.type)}</Badge>
            {c.item && <span className="text-xs text-subtle">{c.item}</span>}
          </div>
          {c.detail && <p className="mt-2 text-sm text-fg">{c.detail}</p>}
          {(c.before || c.after) && (
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              {c.before !== undefined && (
                <div className="rounded-md bg-danger-soft/60 p-2">
                  <p className="text-xs font-medium text-danger">Before</p>
                  <p className="mt-0.5 break-words text-muted">{c.before || '—'}</p>
                </div>
              )}
              {c.after !== undefined && (
                <div className="rounded-md bg-success-soft/60 p-2">
                  <p className="text-xs font-medium text-success">After</p>
                  <p className="mt-0.5 break-words text-muted">{c.after || '—'}</p>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

export function FactCheckReport({ report, changeLog }: { report: ResumeFactCheck; changeLog: ChangeLogEntry[] }) {
  const accepted = changeLog.filter((c) => c.type === 'rewritten')
  const rejections = report.rejections ?? []
  const checked = report.checked ?? 0
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Every AI suggestion is checked against your verified profile. Suggestions that add skills, numbers, employers or
        claims not in your profile are rejected and your original wording is kept.
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge>{checked} checked</Badge>
        <Badge tone="success">{report.accepted ?? 0} accepted</Badge>
        <Badge tone="danger">{report.rejected ?? 0} rejected</Badge>
      </div>
      {report.final_check && (
        <Alert tone={report.final_check.ok ? 'success' : 'warning'} title={report.final_check.ok ? 'Final document check passed' : 'Final document check flagged items'}>
          {report.final_check.notes.length > 0 ? (
            <ul className="list-disc pl-5">
              {report.final_check.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : (
            'Every skill in this resume is present in your profile.'
          )}
        </Alert>
      )}
      {checked === 0 && (
        <p className="text-sm text-subtle">No AI rewriting was applied to this version (deterministic tailoring only, or AI was off/unavailable).</p>
      )}
      {accepted.length > 0 && (
        <div>
          <SectionTitle className="mb-2">Accepted suggestions</SectionTitle>
          <ul className="space-y-2">
            {accepted.map((c, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-fg">{c.after}</p>
                  {c.before && <p className="text-xs text-subtle">Was: {c.before}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rejections.length > 0 && (
        <div>
          <SectionTitle className="mb-2">Rejected suggestions</SectionTitle>
          <ul className="space-y-3">
            {rejections.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-fg line-through decoration-danger/50">{r.text}</p>
                  {r.original && <p className="text-xs text-subtle">Kept original: {r.original}</p>}
                  <ul className="mt-1 list-disc pl-5 text-xs text-danger">
                    {r.reasons.map((reason, j) => (
                      <li key={j}>{reason}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function isKeywordReport(r: ResumeContent['keyword_report']): r is KeywordReport {
  return !!r && Array.isArray((r as KeywordReport).job_skills)
}

export function KeywordReportView({ content }: { content: ResumeContent }) {
  const r = content.keyword_report
  if (!isKeywordReport(r))
    return <EmptyState title="No keyword report" description="Keyword coverage is computed for resumes tailored to a specific job." />
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        {r.covered.length} of {r.job_skills.length} skills mentioned in the posting appear in this resume.
      </p>
      <div>
        <SectionTitle className="mb-2">Covered ({r.covered.length})</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {r.covered.length ? r.covered.map((s) => <Chip key={s} tone="success">{s}</Chip>) : <span className="text-sm text-subtle">None</span>}
        </div>
      </div>
      <div>
        <SectionTitle className="mb-2">Not in your profile ({r.not_in_profile.length})</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {r.not_in_profile.length ? (
            r.not_in_profile.map((s) => <Chip key={s} tone="warning">{s}</Chip>)
          ) : (
            <span className="text-sm text-subtle">None — great coverage.</span>
          )}
        </div>
      </div>
      {r.note && <Alert tone="info">{r.note}</Alert>}
    </div>
  )
}
