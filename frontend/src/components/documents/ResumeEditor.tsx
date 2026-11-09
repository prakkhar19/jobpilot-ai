import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, Input, SectionTitle, Select, TagInput, Textarea } from '@/components/ui'
import type { ResumeContent, ResumeTemplate } from '@/types/api'

interface Props {
  content: ResumeContent
  template: string
  templates: ResumeTemplate[]
  saving?: boolean
  onSave: (content: ResumeContent, template: string) => void
  onCancel?: () => void
}

/** Structured editor for summary, skill groups and experience bullets. Saving creates a new version. */
export function ResumeEditor({ content, template, templates, saving, onSave, onCancel }: Props) {
  const [summary, setSummary] = useState(content.summary ?? '')
  const [skills, setSkills] = useState(() => (content.skills ?? []).map((g) => ({ ...g, items: [...g.items] })))
  const [experiences, setExperiences] = useState(() =>
    (content.experiences ?? []).map((e) => ({ ...e, bullets: [...e.bullets] })),
  )
  const [tpl, setTpl] = useState(template)

  const save = () => {
    onSave(
      {
        ...content,
        summary: summary.trim(),
        skills: skills
          .map((g) => ({ category: g.category.trim() || 'Skills', items: g.items }))
          .filter((g) => g.items.length),
        experiences: experiences.map((e) => ({ ...e, bullets: e.bullets.map((b) => b.trim()).filter(Boolean) })),
      },
      tpl,
    )
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <p className="text-sm text-subtle">
        You are the source of truth for your edits. Saving creates a new version with freshly rendered PDF and DOCX files;
        this version stays unchanged.
      </p>
      <Field label="Template">
        <Select value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name} — {t.description}
            </option>
          ))}
          {!templates.some((t) => t.key === tpl) && <option value={tpl}>{tpl}</option>}
        </Select>
      </Field>
      <Field label="Summary">
        <Textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Skill groups</SectionTitle>
          <Button variant="outline" size="sm" onClick={() => setSkills((s) => [...s, { category: '', items: [] }])}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add group
          </Button>
        </div>
        {skills.map((g, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-end gap-2">
              <Field label={`Group ${i + 1} name`} className="flex-1">
                <Input
                  value={g.category}
                  onChange={(e) => setSkills((s) => s.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
                />
              </Field>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove skill group ${g.category || i + 1}`}
                onClick={() => setSkills((s) => s.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <TagInput
              label={`Skills in ${g.category || `group ${i + 1}`}`}
              value={g.items}
              onChange={(items) => setSkills((s) => s.map((x, j) => (j === i ? { ...x, items } : x)))}
            />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <SectionTitle>Experience bullets</SectionTitle>
        {experiences.length === 0 && <p className="text-sm text-subtle">No experience entries in this version.</p>}
        {experiences.map((exp, i) => (
          <fieldset key={i} className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium text-fg">
              {exp.title} · {exp.company}
            </legend>
            {exp.bullets.map((b, j) => (
              <div key={j} className="flex items-start gap-2">
                <Textarea
                  rows={2}
                  aria-label={`${exp.title} at ${exp.company}, bullet ${j + 1}`}
                  value={b}
                  onChange={(e) =>
                    setExperiences((xs) =>
                      xs.map((x, k) => (k === i ? { ...x, bullets: x.bullets.map((bb, m) => (m === j ? e.target.value : bb)) } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove bullet ${j + 1} from ${exp.title}`}
                  onClick={() =>
                    setExperiences((xs) => xs.map((x, k) => (k === i ? { ...x, bullets: x.bullets.filter((_, m) => m !== j) } : x)))
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExperiences((xs) => xs.map((x, k) => (k === i ? { ...x, bullets: [...x.bullets, ''] } : x)))}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add bullet
            </Button>
          </fieldset>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Discard changes
          </Button>
        )}
        <Button type="submit" loading={saving}>
          Save as new version
        </Button>
      </div>
    </form>
  )
}
