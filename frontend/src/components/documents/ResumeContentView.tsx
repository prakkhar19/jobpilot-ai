import type { ReactNode } from 'react'
import type { ResumeContent } from '@/types/api'
import { cn } from '@/utils/cn'

/** Readable rendering of structured resume content (same sections as the generated PDF/DOCX). */
export function ResumeContentView({ content, className }: { content: ResumeContent; className?: string }) {
  const h = content.header ?? {}
  const contact = [h.email, h.phone, h.location, h.linkedin_url, h.github_url, h.portfolio_url].filter(Boolean)
  return (
    <article className={cn('space-y-5 text-sm text-fg', className)}>
      <header>
        <p className="text-lg font-semibold">{h.full_name || 'Unnamed candidate'}</p>
        {h.headline && <p className="text-muted">{h.headline}</p>}
        {contact.length > 0 && <p className="mt-1 text-xs break-words text-subtle">{contact.join(' · ')}</p>}
      </header>
      {content.summary && (
        <Section title="Summary">
          <p className="leading-6 whitespace-pre-wrap">{content.summary}</p>
        </Section>
      )}
      {content.skills?.length > 0 && (
        <Section title="Skills">
          <dl className="space-y-1">
            {content.skills.map((g, i) => (
              <div key={`${g.category}-${i}`} className="flex flex-wrap gap-x-2">
                <dt className="font-medium">{g.category}:</dt>
                <dd className="text-muted">{g.items.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      {content.experiences?.length > 0 && (
        <Section title="Experience">
          <div className="space-y-3">
            {content.experiences.map((e, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-medium">
                    {e.title}
                    {e.company && <span className="font-normal text-muted"> · {e.company}</span>}
                  </p>
                  <p className="text-xs text-subtle">{[e.location, e.dates].filter(Boolean).join(' · ')}</p>
                </div>
                {e.bullets.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                    {e.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      {!!content.projects?.length && (
        <Section title="Projects">
          <div className="space-y-3">
            {content.projects.map((p, i) => (
              <div key={i}>
                <p className="font-medium">
                  {p.name}
                  {p.technologies?.length > 0 && <span className="font-normal text-subtle"> · {p.technologies.join(', ')}</span>}
                </p>
                {p.description && <p className="text-muted">{p.description}</p>}
                {p.bullets.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                    {p.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      {!!content.education?.length && (
        <Section title="Education">
          <ul className="space-y-1">
            {content.education.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{[e.degree, e.field_of_study].filter(Boolean).join(', ')}</span>
                {e.institution && <span className="text-muted"> · {e.institution}</span>}
                {(e.dates || e.grade) && <span className="text-xs text-subtle"> · {[e.dates, e.grade].filter(Boolean).join(' · ')}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!!content.certifications?.length && (
        <Section title="Certifications">
          <ul className="space-y-0.5 text-muted">
            {content.certifications.map((c, i) => (
              <li key={i}>{[c.name, c.issuer, c.date].filter(Boolean).join(' · ')}</li>
            ))}
          </ul>
        </Section>
      )}
      {!!content.achievements?.length && (
        <Section title="Achievements">
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            {content.achievements.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Section>
      )}
      {!!content.publications?.length && (
        <Section title="Publications">
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            {content.publications.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 border-b border-border pb-1 text-xs font-semibold tracking-wide text-subtle uppercase">{title}</h3>
      {children}
    </section>
  )
}
