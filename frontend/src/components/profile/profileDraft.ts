import type { Certification, Education, Experience, Profile, ProfileData, Project } from '@/types/api'

/** Editor state: like ProfileData but application facts as ordered rows so keys can be renamed safely. */
export interface ProfileDraft extends Omit<ProfileData, 'application_facts'> {
  application_facts: { key: string; value: string }[]
}

/** Keys mirror backend services/tailoring.py CATEGORY_TITLES. */
export const SKILL_CATEGORIES: { key: string; label: string }[] = [
  { key: 'language', label: 'Languages' },
  { key: 'framework', label: 'Frameworks & Libraries' },
  { key: 'ml', label: 'AI / ML' },
  { key: 'data', label: 'Data' },
  { key: 'database', label: 'Databases' },
  { key: 'cloud', label: 'Cloud' },
  { key: 'devops', label: 'DevOps & Tooling' },
  { key: 'tool', label: 'Tools' },
  { key: 'concept', label: 'Concepts' },
  { key: 'practice', label: 'Practices' },
  { key: 'soft', label: 'Professional' },
  { key: 'other', label: 'Other' },
]

export const FACT_SUGGESTIONS = [
  'Work authorization',
  'Requires visa sponsorship',
  'Notice period',
  'Willing to relocate',
  'Expected salary',
  'Earliest start date',
  'Years of experience',
  'Pronouns',
]

export const emptyExperience = (): Experience => ({
  company: '',
  title: '',
  location: '',
  start_date: '',
  end_date: '',
  is_current: false,
  bullets: [],
  technologies: [],
})

export const emptyEducation = (): Education => ({
  institution: '',
  degree: '',
  field_of_study: '',
  start_date: '',
  end_date: '',
  grade: '',
  details: '',
})

export const emptyProject = (): Project => ({
  name: '',
  description: '',
  bullets: [],
  technologies: [],
  url: '',
  start_date: '',
  end_date: '',
})

export const emptyCertification = (): Certification => ({ name: '', issuer: '', issue_date: '', credential_url: '' })

export function toDraft(p: Profile | ProfileData): ProfileDraft {
  return {
    label: p.label ?? '',
    full_name: p.full_name ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    location: p.location ?? '',
    linkedin_url: p.linkedin_url ?? '',
    github_url: p.github_url ?? '',
    portfolio_url: p.portfolio_url ?? '',
    headline: p.headline ?? '',
    summary: p.summary ?? '',
    motivation: p.motivation ?? '',
    achievements: [...(p.achievements ?? [])],
    publications: [...(p.publications ?? [])],
    spoken_languages: [...(p.spoken_languages ?? [])],
    application_facts: Object.entries(p.application_facts ?? {}).map(([key, value]) => ({ key, value: String(value) })),
    educations: (p.educations ?? []).map((e) => ({ ...emptyEducation(), ...e })),
    experiences: (p.experiences ?? []).map((e) => ({
      ...emptyExperience(),
      ...e,
      bullets: [...(e.bullets ?? [])],
      technologies: [...(e.technologies ?? [])],
    })),
    skills: (p.skills ?? []).map((s) => ({ name: s.name, category: s.category || 'other' })),
    projects: (p.projects ?? []).map((x) => ({
      ...emptyProject(),
      ...x,
      bullets: [...(x.bullets ?? [])],
      technologies: [...(x.technologies ?? [])],
    })),
    certifications: (p.certifications ?? []).map((c) => ({ ...emptyCertification(), ...c })),
  }
}

const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean)

/** Converts the editor draft to the PUT /api/profiles/{id} body, dropping blank rows. */
export function fromDraft(d: ProfileDraft): ProfileData {
  const facts: Record<string, string> = {}
  for (const { key, value } of d.application_facts) {
    if (key.trim()) facts[key.trim()] = value.trim()
  }
  return {
    ...d,
    achievements: clean(d.achievements),
    publications: clean(d.publications),
    spoken_languages: clean(d.spoken_languages),
    application_facts: facts,
    experiences: d.experiences
      .filter((e) => e.company.trim() || e.title.trim())
      .map((e) => ({ ...e, bullets: clean(e.bullets), end_date: e.is_current ? '' : e.end_date })),
    educations: d.educations.filter((e) => e.institution.trim() || e.degree.trim()),
    projects: d.projects.filter((p) => p.name.trim()).map((p) => ({ ...p, bullets: clean(p.bullets) })),
    certifications: d.certifications.filter((c) => c.name.trim()),
    skills: d.skills.filter((s) => s.name.trim()),
  }
}
