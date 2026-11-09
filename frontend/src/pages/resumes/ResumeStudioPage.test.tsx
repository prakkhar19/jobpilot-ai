import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ResumeVersion } from '@/types/api'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import ResumeStudioPage from './ResumeStudioPage'

const version: ResumeVersion = {
  id: 'rv1',
  job_id: 'job1',
  profile_id: 'p1',
  parent_version_id: null,
  version_number: 2,
  label: 'Acme — ML Engineer',
  target_role: 'ML Engineer',
  template: 'classic',
  generation_method: 'llm+factcheck',
  provider: 'openai_compatible',
  model: 'gpt-4o-mini',
  created_at: '2026-11-01T00:00:00Z',
  content: {
    header: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
    summary: 'ML engineer with 5 years of experience.',
    skills: [{ category: 'Relevant to this role', items: ['Python', 'PyTorch'] }],
    experiences: [{ company: 'Analytical Engines', title: 'Engineer', location: '', dates: '2020 – Present', bullets: ['Built models'] }],
    keyword_report: {
      job_skills: ['Python', 'Kubernetes'],
      covered: ['Python'],
      not_in_profile: ['Kubernetes'],
      note: 'Skills not in your profile were NOT added.',
    },
  },
  change_log: [{ section: 'skills', type: 'reordered', detail: 'Moved 2 skills that this job asks for to the top.' }],
  fact_check: {
    checked: 2,
    accepted: 1,
    rejected: 1,
    rejections: [{ section: 'e0b0', original: 'Built models', text: 'Built 50 models at Google', reasons: ['Mentions "Google", not in your profile'] }],
    final_check: { ok: true, notes: [] },
  },
}

const templates = { templates: [{ key: 'classic', name: 'Classic', description: 'ATS-safe' }], target_roles: ['AI Engineer'] }

function setup(extra: Record<string, unknown> = {}) {
  return mockFetch({
    'GET /api/resume-versions': [version],
    'GET /api/resume-versions/rv1': version,
    'GET /api/resume-templates': templates,
    'GET /api/jobs': { items: [], total: 0, page: 1, page_size: 100 },
    ...extra,
  })
}

describe('ResumeStudioPage', () => {
  it('shows an empty state with no versions', async () => {
    mockFetch({ 'GET /api/resume-versions': [] })
    renderWithProviders(<ResumeStudioPage />, { route: '/resumes', path: '/resumes' })
    expect(await screen.findByText('No resumes yet')).toBeInTheDocument()
  })

  it('renders a version with downloads, fact-check and keyword reports', async () => {
    setup()
    renderWithProviders(<ResumeStudioPage />, { route: '/resumes/rv1', path: '/resumes/:versionId' })
    expect(await screen.findByText('ML engineer with 5 years of experience.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute('href', '/api/resume-versions/rv1/download/pdf')
    expect(screen.getByRole('link', { name: /DOCX/ })).toHaveAttribute('download')

    await userEvent.click(screen.getByRole('tab', { name: 'Fact-check' }))
    expect(await screen.findByText('Built 50 models at Google')).toBeInTheDocument()
    expect(screen.getByText('Mentions "Google", not in your profile')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Keywords' }))
    expect(await screen.findByText('Kubernetes')).toBeInTheDocument()
    expect(screen.getByText('Skills not in your profile were NOT added.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(await screen.findByTitle(/PDF preview/)).toHaveAttribute('src', '/api/resume-versions/rv1/download/pdf?inline=true')
  })

  it('saves edits as a new version and navigates to it', async () => {
    const fetchMock = setup({
      'POST /api/resume-versions/rv1/edit': { status: 201, body: { ...version, id: 'rv2', version_number: 3 } },
    })
    renderWithProviders(<ResumeStudioPage />, {
      route: '/resumes/rv1',
      path: '/resumes/:versionId',
    })
    await userEvent.click(await screen.findByRole('tab', { name: 'Edit' }))
    const summary = await screen.findByLabelText('Summary')
    await userEvent.clear(summary)
    await userEvent.type(summary, 'Edited summary')
    await userEvent.click(screen.getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/resume-versions/rv1/edit')).toHaveLength(1))
    const body = callsTo(fetchMock, 'POST', '/api/resume-versions/rv1/edit')[0].body as { content: { summary: string }; template: string }
    expect(body.content.summary).toBe('Edited summary')
    expect(body.template).toBe('classic')
  })

  it('generates a resume from the dialog', async () => {
    const fetchMock = setup({ 'POST /api/resume-versions': { status: 201, body: { ...version, id: 'rv5' } } })
    renderWithProviders(<ResumeStudioPage />, {
      route: '/resumes',
      path: '/resumes',
      extraRoutes: <Route path="/resumes/:versionId" element={<div>Opened new version</div>} />,
    })
    await userEvent.click(await screen.findByRole('button', { name: /Generate resume/ }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('option', { name: 'AI Engineer' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Target role'), 'AI Engineer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Opened new version')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/resume-versions')[0].body).toEqual({
      job_id: null,
      target_role: 'AI Engineer',
      template: 'classic',
      use_llm: true,
    })
  })
})
