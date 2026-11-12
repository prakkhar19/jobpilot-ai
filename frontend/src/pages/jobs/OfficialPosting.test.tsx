import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SourceDialog } from '@/components/integrations/SourceDialog'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import type { JobDetail } from '@/types/api'
import JobDetailPage from './JobDetailPage'

const alertJob: JobDetail = {
  id: 'j2', source_kind: 'email_alerts', source_id: null, company: 'Acme AI', title: 'ML Engineer', location: 'Bengaluru',
  workplace_type: 'unknown', employment_type: '', seniority: '', department: '', salary_min: null, salary_max: null,
  salary_currency: '', salary_text: '', posted_at: null, application_url: 'https://www.linkedin.com/jobs/view/1/',
  posting_url: 'https://www.linkedin.com/jobs/view/1/', discovered_at: '2026-11-09T10:00:00Z', last_verified_at: null,
  status: 'active', is_demo: false, hidden: false, duplicate_of_id: null, match_score: null, recommendation: null,
  saved: false, application_status: null, application_id: null, description_text: 'Snippet from alert email.',
  requirements: [], match: null, official_url: '',
}
const official = 'https://job-boards.greenhouse.io/acmeai/jobs/555'

describe('official company posting', () => {
  it('finds the company posting and switches the apply link to it', async () => {
    const fetchMock = mockFetch({
      'GET /api/jobs/j2': alertJob,
      'POST /api/jobs/j2/find-official': { ...alertJob, official_url: official, application_url: official },
    })
    renderWithProviders(<JobDetailPage />, { route: '/jobs/j2', path: '/jobs/:jobId' })
    expect(await screen.findByRole('link', { name: /Open original posting/ })).toHaveAttribute('href', alertJob.posting_url)
    await userEvent.click(screen.getByRole('button', { name: /Find on company site/ }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/jobs/j2/find-official')).toHaveLength(1))
    const link = await screen.findByRole('link', { name: /Apply on company site/ })
    expect(link).toHaveAttribute('href', official)
    expect(screen.getByText('Official company posting')).toBeInTheDocument()
  })
})

describe('SourceDialog credentials', () => {
  it('asks for API keys and sends them; identifier falls back to the default', async () => {
    const fetchMock = mockFetch({
      'GET /api/sources/catalog': {
        supported: [{ kind: 'adzuna', label: 'Adzuna', description: 'Search', identifier_help: 'Country code',
                      identifier_default: 'in',
                      credential_fields: [{ key: 'app_id', label: 'Adzuna App ID', secret: false },
                                          { key: 'app_key', label: 'Adzuna App Key', secret: true }] }],
        unsupported: [],
      },
      'POST /api/sources': { id: 's1', kind: 'adzuna', identifier: 'in', display_name: 'Adzuna (IN)', enabled: true,
                             last_checked_at: null, last_status: 'never', last_error: '', jobs_found: 0,
                             created_at: '2026-11-10T00:00:00Z', has_credentials: true },
    })
    renderWithProviders(<SourceDialog open onOpenChange={() => {}} onCreated={() => {}} />)
    const key = await screen.findByLabelText(/Adzuna App Key/)
    expect(key).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    expect(await screen.findByText(/Please fill in/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Adzuna App ID/), 'id1')
    await userEvent.type(key, 'secret1')
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/sources')).toHaveLength(1))
    const body = callsTo(fetchMock, 'POST', '/api/sources')[0].body as { credentials: Record<string, string>; kind: string }
    expect(body.credentials).toEqual({ app_id: 'id1', app_key: 'secret1' })
    expect(body.kind).toBe('adzuna')
  })
})
