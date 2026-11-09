import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import type { Job } from '@/types/api'
import JobsPage from './JobsPage'

const job: Job = {
  id: 'j1', source_kind: 'greenhouse', source_id: 's1', company: 'Acme', title: 'Backend Engineer', location: 'Berlin',
  workplace_type: 'remote', employment_type: 'Full-time', seniority: 'senior', department: '', salary_min: null,
  salary_max: null, salary_currency: '', salary_text: '', posted_at: null, application_url: '', posting_url: '',
  discovered_at: '2026-11-09T10:00:00Z', last_verified_at: null, status: 'active', is_demo: false, hidden: false,
  duplicate_of_id: null, match_score: 81.2, recommendation: 'strong_match', saved: false, application_status: null, application_id: null,
}

describe('JobsPage', () => {
  it('shows the empty state when there are no jobs', async () => {
    mockFetch({ 'GET /api/jobs': { items: [], total: 0, page: 1, page_size: 20 } })
    renderWithProviders(<JobsPage view="all" />, { route: '/jobs' })
    expect(await screen.findByText('No jobs yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add sources' })).toHaveAttribute('href', '/integrations')
  })

  it('shows a saved-specific empty state', async () => {
    const fetchMock = mockFetch({ 'GET /api/jobs': { items: [], total: 0, page: 1, page_size: 20 } })
    renderWithProviders(<JobsPage view="saved" />, { route: '/jobs/saved' })
    expect(await screen.findByText('No saved jobs yet')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'GET', '/api/jobs')[0].url.searchParams.get('view')).toBe('saved')
  })

  it('shows the error state with retry', async () => {
    mockFetch({ 'GET /api/jobs': { status: 500, body: { detail: 'Database unavailable' } } })
    renderWithProviders(<JobsPage view="all" />, { route: '/jobs' })
    expect(await screen.findByText('Could not load jobs')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable')).toBeInTheDocument()
  })

  it('renders jobs and saves one', async () => {
    const fetchMock = mockFetch({
      'GET /api/jobs': { items: [job], total: 1, page: 1, page_size: 20 },
      'PUT /api/jobs/j1/save': { status: 204 },
    })
    renderWithProviders(<JobsPage view="all" />, { route: '/jobs' })
    expect(await screen.findByRole('link', { name: 'Backend Engineer' })).toHaveAttribute('href', '/jobs/j1')
    expect(screen.getByText('Strong match')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save Backend Engineer' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/jobs/j1/save')).toHaveLength(1))
  })

  it('passes filters from the URL to the API', async () => {
    const fetchMock = mockFetch({ 'GET /api/jobs': { items: [], total: 0, page: 1, page_size: 20 } })
    renderWithProviders(<JobsPage view="all" />, { route: '/jobs?workplace=remote&min_score=70&sort=score' })
    expect(await screen.findByText('No jobs match these filters')).toBeInTheDocument()
    const url = callsTo(fetchMock, 'GET', '/api/jobs')[0].url
    expect(url.searchParams.get('workplace_type')).toBe('remote')
    expect(url.searchParams.get('min_score')).toBe('70')
    expect(url.searchParams.get('sort')).toBe('score')
  })
})
