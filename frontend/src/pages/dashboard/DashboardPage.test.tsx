import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithProviders } from '@/test/utils'
import DashboardPage from './DashboardPage'
import { summaryFixture } from './fixtures'

const base = {
  'GET /api/analytics/weekly-report': { since: '', discovered: 40, submitted: 3, responses: 1, pending: 3, text: 'In the last 7 days: 40 new job(s) discovered.' },
  'GET /api/agent/logs': [
    { id: 'l1', task_id: 't1', level: 'info', step: 'discovery', message: 'Fetched 40 jobs from Acme board', data: {}, created_at: '2026-11-09T10:00:00Z' },
  ],
  'GET /api/notifications': {
    items: [{ id: 'n1', kind: 'approval', title: '3 applications await approval', body: '', link: '/applications', read_at: null, created_at: '2026-11-09T11:00:00Z' }],
    unread: 1,
  },
  'GET /api/diagnostics': {
    checks: { worker: { status: 'ok', last_seen_at: '2026-11-09T11:00:00Z' }, scheduler: { status: 'stale', last_seen_at: '2026-11-08T11:00:00Z' } },
  },
  'GET /api/agent/tasks': [
    { id: 't1', kind: 'pipeline', trigger: 'manual', state: 'COMPLETED', cancel_requested: false, attempt: 1, stats: {}, error: '', created_at: '2026-11-09T10:00:00Z', started_at: null, finished_at: null, heartbeat_at: null },
  ],
}

describe('DashboardPage', () => {
  it('renders widget numbers from the analytics summary', async () => {
    mockFetch({ ...base, 'GET /api/analytics/summary': summaryFixture() })
    renderWithProviders(<DashboardPage />)
    const metrics = await screen.findByRole('region', { name: 'Key metrics' })
    expect(await within(metrics).findByText('128')).toBeInTheDocument()
    expect(within(metrics).getByText('Jobs discovered')).toBeInTheDocument()
    expect(within(metrics).getByText('17')).toBeInTheDocument()
    expect(within(metrics).getByText('Score ≥ 60')).toBeInTheDocument()
    expect(within(metrics).getByText('Pending approvals').closest('a')).toHaveAttribute('href', '/applications?status=awaiting_approval,needs_input')
    expect(within(metrics).getByText('11')).toBeInTheDocument()
    expect(within(metrics).getByText('Response rate 36.4%')).toBeInTheDocument()
    expect(screen.getByText('In the last 7 days: 40 new job(s) discovered.')).toBeInTheDocument()
  })

  it('shows recent activity and agent health', async () => {
    mockFetch({ ...base, 'GET /api/analytics/summary': summaryFixture() })
    renderWithProviders(<DashboardPage />)
    expect(await screen.findByText('Fetched 40 jobs from Acme board')).toBeInTheDocument()
    expect(screen.getByText('3 applications await approval').closest('a')).toHaveAttribute('href', '/applications')
    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('Stale')).toBeInTheDocument()
    expect(await screen.findByText('Completed')).toBeInTheDocument()
  })

  it('shows an error state when analytics fail', async () => {
    mockFetch({ ...base, 'GET /api/analytics/summary': { status: 500, body: { detail: 'Internal server error. Check the server logs.' } } })
    renderWithProviders(<DashboardPage />)
    expect(await screen.findByText('Could not load your metrics')).toBeInTheDocument()
    expect(screen.getByText('Internal server error. Check the server logs.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})
