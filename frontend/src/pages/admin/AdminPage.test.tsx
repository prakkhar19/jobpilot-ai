import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { authStatus, callsTo, mockFetch, renderWithProviders, testUser } from '@/test/utils'
import AdminPage from './AdminPage'

describe('AdminPage', () => {
  it('lists users and deactivates another user', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/status': authStatus({ user: { ...testUser, role: 'admin' } }),
      'GET /api/admin/users': [
        { id: 'u1', email: 'ada@example.com', full_name: 'Ada', role: 'admin', is_active: true, created_at: '2026-01-01T00:00:00Z', last_login_at: null },
        { id: 'u2', email: 'bob@example.com', full_name: 'Bob', role: 'user', is_active: true, created_at: '2026-01-02T00:00:00Z', last_login_at: null },
      ],
      'POST /api/admin/users/:id/active': { status: 204 },
    })
    renderWithProviders(<AdminPage />)
    expect(await screen.findByText('bob@example.com')).toBeInTheDocument()
    // the admin cannot deactivate themselves
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/admin/users/u2/active')).toHaveLength(1))
    expect(callsTo(fetchMock, 'POST', '/api/admin/users/u2/active')[0].url.searchParams.get('active')).toBe('false')
  })
})
