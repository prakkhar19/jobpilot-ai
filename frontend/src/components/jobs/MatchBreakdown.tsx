import { CheckCircle2, CircleHelp, MinusCircle } from 'lucide-react'
import { Badge, Chip, ScoreBar, SectionTitle } from '@/components/ui'
import type { ConfidenceEntry, Match, MatchComponent } from '@/types/api'
import { RECOMMENDATION_LABELS, RECOMMENDATION_TEXT, recommendationTone, type Tone } from '@/utils/constants'
import { humanize } from '@/utils/format'

function isConfidence(c: MatchComponent | ConfidenceEntry): c is ConfidenceEntry {
  return c.key === '_confidence'
}

function splitComponents(match: Match): { components: MatchComponent[]; confidence: number | null } {
  let confidence: number | null = null
  const components: MatchComponent[] = []
  for (const c of match.components ?? []) {
    if (isConfidence(c)) confidence = typeof c.value === 'number' ? c.value : null
    else components.push(c)
  }
  return { components, confidence }
}

const STATUS_META: Record<string, { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  scored: { label: 'Scored', tone: 'primary', icon: CheckCircle2 },
  unknown: { label: 'Unknown', tone: 'warning', icon: CircleHelp },
  not_applicable: { label: 'Not applicable', tone: 'neutral', icon: MinusCircle },
}

export function MatchComponentRow({ c }: { c: MatchComponent }) {
  const meta = STATUS_META[c.status] ?? STATUS_META.unknown
  const Icon = meta.icon
  const scored = c.status === 'scored'
  return (
    <li className="py-3" data-testid={`component-${c.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg">{c.label || humanize(c.key)}</span>
          <Badge tone={meta.tone}>
            <Icon className="h-3 w-3" aria-hidden="true" />
            {meta.label}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-subtle tabular-nums">
          <span>Weight {Math.round((c.weight ?? 0) * 100)}%</span>
          <span className="font-semibold text-fg">{scored && c.score !== null ? `${Math.round(c.score)}/100` : '—'}</span>
        </div>
      </div>
      {scored ? (
        <ScoreBar value={c.score} label={`${c.label} score`} className="mt-2" />
      ) : (
        <div className="mt-2 h-2 w-full rounded-full border border-dashed border-border-strong" aria-hidden="true" />
      )}
      {c.detail && <p className="mt-1.5 text-xs text-muted">{c.detail}</p>}
      {(c.matched?.length > 0 || c.missing?.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.matched?.map((m) => (
            <Chip key={`m-${m}`} tone="success">
              <span className="sr-only">Matched: </span>
              {m}
            </Chip>
          ))}
          {c.missing?.map((m) => (
            <Chip key={`x-${m}`} tone="danger">
              <span className="sr-only">Missing: </span>
              {m}
            </Chip>
          ))}
        </div>
      )}
    </li>
  )
}

function List({ title, items, tone }: { title: string; items: string[]; tone: 'success' | 'danger' | 'warning' }) {
  if (!items?.length) return null
  const dot = { success: 'bg-success', danger: 'bg-danger', warning: 'bg-warning' }[tone]
  return (
    <div>
      <SectionTitle className="mb-2">{title}</SectionTitle>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm text-fg">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Explainable match: every component with its score, weight, status and evidence. */
export function MatchBreakdown({ match }: { match: Match }) {
  const { components, confidence } = splitComponents(match)
  const rec = match.recommendation as keyof typeof RECOMMENDATION_TEXT
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">{Math.round(match.overall_score)}</span>
        <span className="text-sm text-subtle">/ 100 overall</span>
        <Badge tone={recommendationTone(match.recommendation)}>
          {RECOMMENDATION_LABELS[rec] ?? humanize(match.recommendation)}
        </Badge>
        {confidence !== null && (
          <span className="text-xs text-subtle" title="How much of the score is based on known data">
            Confidence {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
      {RECOMMENDATION_TEXT[rec] && <p className="text-sm text-muted">{RECOMMENDATION_TEXT[rec]}</p>}
      <ul className="divide-y divide-border" aria-label="Match components">
        {components.map((c) => (
          <MatchComponentRow key={c.key} c={c} />
        ))}
      </ul>
      <p className="text-xs text-subtle">
        Unknown components are excluded from the average — missing profile data is not treated as a lack of skill.
        {match.similarity_method ? ` Similarity method: ${match.similarity_method}.` : ''}
      </p>
      <div className="grid gap-5 md:grid-cols-3">
        <List title="Strengths" items={match.strengths} tone="success" />
        <List title="Gaps" items={match.gaps} tone="danger" />
        <List title="Unknowns" items={match.unknowns} tone="warning" />
      </div>
    </div>
  )
}
