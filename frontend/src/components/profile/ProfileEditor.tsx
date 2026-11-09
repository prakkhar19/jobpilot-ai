import { Plus, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, TagInput, Textarea } from '@/components/ui'
import type { Certification, Education, Experience, Project } from '@/types/api'
import {
  emptyCertification,
  emptyEducation,
  emptyExperience,
  emptyProject,
  FACT_SUGGESTIONS,
  SKILL_CATEGORIES,
  type ProfileDraft,
} from './profileDraft'
import { StringListEditor } from './StringListEditor'

interface Props {
  value: ProfileDraft
  onChange: (next: ProfileDraft) => void
}

function Section({ title, description, actions, children }: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  )
}

function ItemShell({ title, onRemove, removeLabel, children }: {
  title: string
  onRemove: () => void
  removeLabel: string
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={removeLabel}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
        </Button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

/** Full nested editor for a candidate profile (controlled). */
export function ProfileEditor({ value, onChange }: Props) {
  const set = <K extends keyof ProfileDraft>(key: K, v: ProfileDraft[K]) => onChange({ ...value, [key]: v })
  const updateList = <K extends 'experiences' | 'educations' | 'projects' | 'certifications'>(
    key: K,
    i: number,
    patch: Partial<ProfileDraft[K][number]>,
  ) => set(key, value[key].map((item, j) => (j === i ? { ...item, ...patch } : item)) as ProfileDraft[K])
  const removeFrom = <K extends 'experiences' | 'educations' | 'projects' | 'certifications'>(key: K, i: number) =>
    set(key, value[key].filter((_, j) => j !== i) as ProfileDraft[K])

  const [skillName, setSkillName] = useState('')
  const [skillCat, setSkillCat] = useState('other')
  const addSkill = () => {
    const names = skillName.split(',').map((s) => s.trim()).filter(Boolean)
    if (!names.length) return
    const existing = new Set(value.skills.map((s) => s.name.toLowerCase()))
    const added = names.filter((n) => !existing.has(n.toLowerCase())).map((name) => ({ name, category: skillCat }))
    set('skills', [...value.skills, ...added])
    setSkillName('')
  }

  const text = (label: string, key: keyof ProfileDraft, type = 'text', autoComplete?: string) => (
    <Field label={label}>
      <Input
        type={type}
        autoComplete={autoComplete}
        value={value[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </Field>
  )

  return (
    <div className="space-y-5">
      <Section title="Contact & basics" description="Used in resume headers and to fill standard application fields.">
        <div className="grid gap-4 sm:grid-cols-2">
          {text('Profile label', 'label')}
          {text('Full name', 'full_name', 'text', 'name')}
          {text('Email', 'email', 'email', 'email')}
          {text('Phone', 'phone', 'tel', 'tel')}
          {text('Location', 'location')}
          {text('LinkedIn URL', 'linkedin_url', 'url')}
          {text('GitHub URL', 'github_url', 'url')}
          {text('Portfolio URL', 'portfolio_url', 'url')}
        </div>
        {text('Headline', 'headline')}
        <Field label="Summary">
          <Textarea rows={4} value={value.summary} onChange={(e) => set('summary', e.target.value)} />
        </Field>
        <Field label="Motivation" hint="What you are looking for next. Used for cover letters — never invented.">
          <Textarea rows={3} value={value.motivation} onChange={(e) => set('motivation', e.target.value)} />
        </Field>
      </Section>

      <Section
        title="Experience"
        actions={
          <Button variant="outline" size="sm" onClick={() => set('experiences', [...value.experiences, emptyExperience()])}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add experience
          </Button>
        }
      >
        {value.experiences.length === 0 && <p className="text-sm text-subtle">No experience entries yet.</p>}
        {value.experiences.map((exp: Experience, i) => (
          <ItemShell
            key={i}
            title={[exp.title, exp.company].filter(Boolean).join(' @ ') || `Experience ${i + 1}`}
            onRemove={() => removeFrom('experiences', i)}
            removeLabel={`Remove experience ${i + 1}`}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job title">
                <Input value={exp.title} onChange={(e) => updateList('experiences', i, { title: e.target.value })} />
              </Field>
              <Field label="Company">
                <Input value={exp.company} onChange={(e) => updateList('experiences', i, { company: e.target.value })} />
              </Field>
              <Field label="Location">
                <Input value={exp.location} onChange={(e) => updateList('experiences', i, { location: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start" hint="e.g. 2021-03">
                  <Input value={exp.start_date} onChange={(e) => updateList('experiences', i, { start_date: e.target.value })} />
                </Field>
                <Field label="End">
                  <Input
                    value={exp.is_current ? '' : exp.end_date}
                    disabled={exp.is_current}
                    placeholder={exp.is_current ? 'Present' : ''}
                    onChange={(e) => updateList('experiences', i, { end_date: e.target.value })}
                  />
                </Field>
              </div>
            </div>
            <Checkbox
              label="I currently work here"
              checked={exp.is_current}
              onCheckedChange={(v) => updateList('experiences', i, { is_current: v })}
            />
            <StringListEditor
              label="Bullet points"
              addLabel="Add bullet"
              multiline
              items={exp.bullets}
              onChange={(bullets) => updateList('experiences', i, { bullets })}
            />
            <TagInput
              label="Technologies"
              value={exp.technologies}
              onChange={(technologies) => updateList('experiences', i, { technologies })}
            />
          </ItemShell>
        ))}
      </Section>

      <Section
        title="Education"
        actions={
          <Button variant="outline" size="sm" onClick={() => set('educations', [...value.educations, emptyEducation()])}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add education
          </Button>
        }
      >
        {value.educations.length === 0 && <p className="text-sm text-subtle">No education entries yet.</p>}
        {value.educations.map((ed: Education, i) => (
          <ItemShell
            key={i}
            title={[ed.degree, ed.institution].filter(Boolean).join(', ') || `Education ${i + 1}`}
            onRemove={() => removeFrom('educations', i)}
            removeLabel={`Remove education ${i + 1}`}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Institution">
                <Input value={ed.institution} onChange={(e) => updateList('educations', i, { institution: e.target.value })} />
              </Field>
              <Field label="Degree">
                <Input value={ed.degree} onChange={(e) => updateList('educations', i, { degree: e.target.value })} />
              </Field>
              <Field label="Field of study">
                <Input value={ed.field_of_study} onChange={(e) => updateList('educations', i, { field_of_study: e.target.value })} />
              </Field>
              <Field label="Grade">
                <Input value={ed.grade} onChange={(e) => updateList('educations', i, { grade: e.target.value })} />
              </Field>
              <Field label="Start">
                <Input value={ed.start_date} onChange={(e) => updateList('educations', i, { start_date: e.target.value })} />
              </Field>
              <Field label="End">
                <Input value={ed.end_date} onChange={(e) => updateList('educations', i, { end_date: e.target.value })} />
              </Field>
            </div>
            <Field label="Details">
              <Textarea rows={2} value={ed.details} onChange={(e) => updateList('educations', i, { details: e.target.value })} />
            </Field>
          </ItemShell>
        ))}
      </Section>

      <Section title="Skills" description="Only skills listed here (or evidenced in your text) are ever used in tailored resumes.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Skill" className="min-w-[12rem] flex-1" hint="Separate several with commas.">
            <Input
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSkill()
                }
              }}
            />
          </Field>
          <Field label="Category" className="w-48" hint=" ">
            <Select value={skillCat} onChange={(e) => setSkillCat(e.target.value)}>
              {SKILL_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="outline" onClick={addSkill} className="mb-5">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add skill
          </Button>
        </div>
        {value.skills.length === 0 ? (
          <p className="text-sm text-subtle">No skills yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Skills">
            {value.skills.map((s, i) => (
              <li key={`${s.name}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs">
                <span className="font-medium text-fg">{s.name}</span>
                <select
                  aria-label={`Category for ${s.name}`}
                  value={s.category}
                  onChange={(e) =>
                    set('skills', value.skills.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))
                  }
                  className="rounded bg-transparent px-1 text-subtle"
                >
                  {SKILL_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-subtle hover:bg-border hover:text-fg"
                  aria-label={`Remove skill ${s.name}`}
                  onClick={() => set('skills', value.skills.filter((_, j) => j !== i))}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Projects"
        actions={
          <Button variant="outline" size="sm" onClick={() => set('projects', [...value.projects, emptyProject()])}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add project
          </Button>
        }
      >
        {value.projects.length === 0 && <p className="text-sm text-subtle">No projects yet.</p>}
        {value.projects.map((p: Project, i) => (
          <ItemShell key={i} title={p.name || `Project ${i + 1}`} onRemove={() => removeFrom('projects', i)} removeLabel={`Remove project ${i + 1}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Project name">
                <Input value={p.name} onChange={(e) => updateList('projects', i, { name: e.target.value })} />
              </Field>
              <Field label="URL">
                <Input type="url" value={p.url} onChange={(e) => updateList('projects', i, { url: e.target.value })} />
              </Field>
              <Field label="Start">
                <Input value={p.start_date} onChange={(e) => updateList('projects', i, { start_date: e.target.value })} />
              </Field>
              <Field label="End">
                <Input value={p.end_date} onChange={(e) => updateList('projects', i, { end_date: e.target.value })} />
              </Field>
            </div>
            <Field label="Description">
              <Textarea rows={2} value={p.description} onChange={(e) => updateList('projects', i, { description: e.target.value })} />
            </Field>
            <StringListEditor label="Project bullets" addLabel="Add bullet" multiline items={p.bullets} onChange={(bullets) => updateList('projects', i, { bullets })} />
            <TagInput label="Project technologies" value={p.technologies} onChange={(technologies) => updateList('projects', i, { technologies })} />
          </ItemShell>
        ))}
      </Section>

      <Section
        title="Certifications"
        actions={
          <Button variant="outline" size="sm" onClick={() => set('certifications', [...value.certifications, emptyCertification()])}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add certification
          </Button>
        }
      >
        {value.certifications.length === 0 && <p className="text-sm text-subtle">No certifications yet.</p>}
        {value.certifications.map((c: Certification, i) => (
          <ItemShell key={i} title={c.name || `Certification ${i + 1}`} onRemove={() => removeFrom('certifications', i)} removeLabel={`Remove certification ${i + 1}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={c.name} onChange={(e) => updateList('certifications', i, { name: e.target.value })} />
              </Field>
              <Field label="Issuer">
                <Input value={c.issuer} onChange={(e) => updateList('certifications', i, { issuer: e.target.value })} />
              </Field>
              <Field label="Issue date">
                <Input value={c.issue_date} onChange={(e) => updateList('certifications', i, { issue_date: e.target.value })} />
              </Field>
              <Field label="Credential URL">
                <Input type="url" value={c.credential_url} onChange={(e) => updateList('certifications', i, { credential_url: e.target.value })} />
              </Field>
            </div>
          </ItemShell>
        ))}
      </Section>

      <Section title="Achievements, publications & languages">
        <StringListEditor label="Achievements" addLabel="Add achievement" multiline items={value.achievements} onChange={(v) => set('achievements', v)} />
        <StringListEditor label="Publications" addLabel="Add publication" multiline items={value.publications} onChange={(v) => set('publications', v)} />
        <TagInput label="Spoken languages" value={value.spoken_languages} onChange={(v) => set('spoken_languages', v)} placeholder="e.g. English (native)" />
      </Section>

      <Section
        title="Application facts"
        description='Facts used to answer screening questions on application forms, such as "Work authorization" or "Notice period". JobPilot never guesses these — unanswered required questions stop for your input.'
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => set('application_facts', [...value.application_facts, { key: '', value: '' }])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add fact
          </Button>
        }
      >
        {value.application_facts.length === 0 && <p className="text-sm text-subtle">No application facts yet.</p>}
        <datalist id="fact-suggestions">
          {FACT_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {value.application_facts.map((f, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Field label={`Question ${i + 1}`}>
              <Input
                list="fact-suggestions"
                value={f.key}
                placeholder="Work authorization"
                onChange={(e) =>
                  set('application_facts', value.application_facts.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                }
              />
            </Field>
            <Field label={`Answer ${i + 1}`}>
              <Input
                value={f.value}
                placeholder="Authorized to work in the EU"
                onChange={(e) =>
                  set('application_facts', value.application_facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                }
              />
            </Field>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove fact ${i + 1}`}
              onClick={() => set('application_facts', value.application_facts.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </Section>
    </div>
  )
}
