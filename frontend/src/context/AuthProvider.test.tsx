import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithProviders } from '@/test/utils'
import { useAuth } from './auth'

function WhoAmI() {
  const { user, logout } = useAuth()
  return (
    <div>
      <p>{user ? `Signed in as ${user.email}` : 'Signed out'}</p>
      <button onClick={() => void logout()}>Log out</button>
    </div>
  )
}

describe('AuthProvider', () => {
  it('shows the user as signed out immediately after logout', async () => {
    mockFetch({ 'POST /api/auth/logout': { status: 204 } })
    renderWithProviders(<WhoAmI />)
    expect(await screen.findByText('Signed in as ada@example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
  })
})
