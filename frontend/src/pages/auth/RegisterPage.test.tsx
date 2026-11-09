import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authStatus, callsTo, mockFetch, renderWithProviders, testUser } from '@/test/utils'
import RegisterPage from './RegisterPage'

describe('RegisterPage', () => {
  it('shows "registration closed" when registration is not open', async () => {
    mockFetch({ 'GET /api/auth/status': authStatus({ user: null, registration_open: false, single_user_mode: true }) })
    renderWithProviders(<RegisterPage />, { route: '/signup', path: '/signup' })
    expect(await screen.findByRole('heading', { name: 'Registration closed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument()
  })

  it('validates password length and confirmation', async () => {
    const fetchMock = mockFetch({ 'GET /api/auth/status': authStatus({ user: null }) })
    renderWithProviders(<RegisterPage />, { route: '/signup', path: '/signup' })
    await userEvent.type(await screen.findByLabelText(/^Email/), 'new@example.com')
    await userEvent.type(screen.getByLabelText(/^Password/), 'short')
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'different')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/auth/register')).toHaveLength(0)
  })

  it('registers and goes to onboarding', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/status': authStatus({ user: null }),
      'POST /api/auth/register': { status: 201, body: authStatus({ user: { ...testUser, onboarding_completed: false } }) },
    })
    renderWithProviders(<RegisterPage />, {
      route: '/signup',
      path: '/signup',
      extraRoutes: <Route path="/onboarding" element={<div>Onboarding wizard</div>} />,
    })
    await userEvent.type(await screen.findByLabelText(/^Full name/), 'Grace Hopper')
    await userEvent.type(screen.getByLabelText(/^Email/), 'grace@example.com')
    await userEvent.type(screen.getByLabelText(/^Password/), 'a-long-password')
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'a-long-password')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Onboarding wizard')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/auth/register')[0].body).toEqual({
      email: 'grace@example.com',
      password: 'a-long-password',
      full_name: 'Grace Hopper',
    })
  })
})
