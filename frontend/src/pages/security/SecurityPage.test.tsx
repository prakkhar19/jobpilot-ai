import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import type { Diagnostics } from '@/types/api'
import SecurityPage from './SecurityPage'

const diagnostics: Diagnostics = {
  version: '0.1.0',
  environment: 'development',
  python: '3.12.0',
  checks: {
    database: { status: 'ok' },
    worker: { status: 'stale', last_seen_at: '2026-11-09T00:00:00Z', age_seconds: 900 },
    scheduler: { status: 'unknown', last_seen_at: null },
  },
  connectors: [],
  ai_providers: [],
  recent_failures: [{ id: 't1', error: 'Greenhouse timed out', created_at: '2026-11-09T10:00:00Z' }],
  application_providers: [{ key: 'manual', label: 'Manual', inspection: false, assisted_fill: false, automated_submit: false, note: '' }],
  unsupported_platforms: [{ platform: 'linkedin', reason: 'LinkedIn prohibits automated scraping.' }],
  settings: { demo_mode: true, single_user_mode: false, registration: true, cookie_secure: false, max_upload_mb: 10 },
}

const routes = {
  'GET /api/auth/sessions': [
    { id: 's1', created_at: '2026-11-01T00:00:00Z', last_seen_at: '2026-11-10T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', ip_address: '10.0.0.1', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130 Safari/537', current: true },
    { id: 's2', created_at: '2026-11-02T00:00:00Z', last_seen_at: '2026-11-09T00:00:00Z', expires_at: '2026-12-02T00:00:00Z', ip_address: '10.0.0.2', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/130', current: false },
  ],
  'GET /api/audit-log': [
    { id: 'a1', action: 'auth.login', target_type: null, target_id: null, ip_address: '10.0.0.1', data: {}, created_at: '2026-11-10T00:00:00Z' },
  ],
  'GET /api/diagnostics': diagnostics,
}

describe('SecurityPage', () => {
  it('renders sessions, audit log, diagnostics and the export link', async () => {
    mockFetch(routes)
    renderWithProviders(<SecurityPage />)
    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument()
    expect(screen.getByText('This device')).toBeInTheDocument()
    expect(await screen.findByText('auth.login')).toBeInTheDocument()
    expect(await screen.findByText('Greenhouse timed out')).toBeInTheDocument()
    expect(screen.getByText('LinkedIn prohibits automated scraping.')).toBeInTheDocument()
    expect(screen.getByText('Stale')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download export/ })).toHaveAttribute('href', '/api/account/export')
  })

  it('revokes another session after confirmation', async () => {
    const fetchMock = mockFetch({ ...routes, 'DELETE /api/auth/sessions/:id': { status: 204 } })
    renderWithProviders(<SecurityPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(callsTo(fetchMock, 'DELETE', '/api/auth/sessions/s2')).toHaveLength(1))
  })

  it('delete account requires the password and typing DELETE', async () => {
    const fetchMock = mockFetch({ ...routes, 'POST /api/auth/delete-account': { status: 204 } })
    renderWithProviders(<SecurityPage />)
    await userEvent.click(await screen.findByRole('button', { name: /Delete account…/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account' })
    const submit = within(dialog).getByRole('button', { name: 'Delete account permanently' })
    expect(submit).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Current password/), 'my-password-123')
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), 'delete')
    expect(submit).toBeDisabled()
    await userEvent.clear(within(dialog).getByLabelText(/to confirm/))
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), 'DELETE')
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument())
    expect(callsTo(fetchMock, 'POST', '/api/auth/delete-account')[0].body).toEqual({ password: 'my-password-123', confirm: 'DELETE' })
  })
})
