import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import type { JobDetail } from '@/types/api'
import JobDetailPage from './JobDetailPage'

const detail: JobDetail = {
  id: 'j1', source_kind: 'lever', source_id: null, company: 'Acme', title: 'ML Engineer', location: 'Remote',
  workplace_type: 'remote', employment_type: '', seniority: '', department: '', salary_min: null, salary_max: null,
  salary_currency: '', salary_text: '', posted_at: null, application_url: 'https://jobs.lever.co/acme/1/apply',
  posting_url: 'https://jobs.lever.co/acme/1', discovered_at: '2026-11-09T10:00:00Z', last_verified_at: null,
  status: 'active', is_demo: false, hidden: false, duplicate_of_id: null, match_score: null, recommendation: null,
  saved: false, application_status: null, application_id: null, description_text: 'Build ML systems.',
  requirements: [{ kind: 'skill', text: 'Python', skill_name: 'Python', is_mandatory: true, value_num: null }],
  match: null,
}

describe('JobDetailPage', () => {
  const render = () =>
    renderWithProviders(<JobDetailPage />, {
      route: '/jobs/j1',
      path: '/jobs/:jobId',
      extraRoutes: (
        <>
          <Route path="/resumes/:id" element={<div>Resume version page</div>} />
          <Route path="/applications/:id" element={<div>Application page</div>} />
        </>
      ),
    })

  it('shows details, unmatched state and the original posting link', async () => {
    mockFetch({ 'GET /api/jobs/j1': detail })
    render()
    expect(await screen.findByRole('heading', { name: 'ML Engineer' })).toBeInTheDocument()
    expect(screen.getByText('Not matched yet')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Open original posting/ })
    expect(link).toHaveAttribute('href', 'https://jobs.lever.co/acme/1')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('generates a tailored resume and navigates to it', async () => {
    const fetchMock = mockFetch({ 'GET /api/jobs/j1': detail, 'POST /api/resume-versions': { id: 'rv9', version_number: 1 } })
    render()
    await userEvent.click(await screen.findByRole('button', { name: /Generate resume/ }))
    expect(await screen.findByText('Resume version page')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/resume-versions')[0].body).toEqual({ job_id: 'j1' })
  })

  it('prepares an application in the chosen mode', async () => {
    const fetchMock = mockFetch({ 'GET /api/jobs/j1': detail, 'POST /api/applications/prepare': { id: 'a1' } })
    render()
    await userEvent.click(await screen.findByRole('button', { name: /Prepare application/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Assisted/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(await screen.findByText('Application page')).toBeInTheDocument()
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/applications/prepare')[0].body).toEqual({ job_id: 'j1', mode: 'assisted' }))
  })
})
