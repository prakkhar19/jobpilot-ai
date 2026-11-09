import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authStatus, callsTo, mockFetch, renderWithProviders, testUser } from '@/test/utils'
import LoginPage from './LoginPage'

const loggedOut = authStatus({ user: null, csrf_token: null })

describe('LoginPage', () => {
  it('validates required fields without calling the API', async () => {
    const fetchMock = mockFetch({ 'GET /api/auth/status': loggedOut })
    renderWithProviders(<LoginPage />, { route: '/signin', path: '/signin' })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Email is required.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/)).toHaveAttribute('aria-invalid', 'true')
    expect(callsTo(fetchMock, 'POST', '/api/auth/login')).toHaveLength(0)
  })

  it('rejects malformed email', async () => {
    mockFetch({ 'GET /api/auth/status': loggedOut })
    renderWithProviders(<LoginPage />, { route: '/signin', path: '/signin' })
    await userEvent.type(await screen.findByLabelText(/Email/), 'not-an-email')
    await userEvent.type(screen.getByLabelText(/Password/), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
  })

  it('submits credentials and navigates to the dashboard', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/status': loggedOut,
      'POST /api/auth/login': authStatus({ user: testUser, csrf_token: 'new-csrf' }),
    })
    renderWithProviders(<LoginPage />, {
      route: '/signin',
      path: '/signin',
      extraRoutes: <Route path="/" element={<div>Dashboard home</div>} />,
    })
    await userEvent.type(await screen.findByLabelText(/Email/), 'ada@example.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'correct horse battery')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument()
    const [call] = callsTo(fetchMock, 'POST', '/api/auth/login')
    expect(call.body).toEqual({ email: 'ada@example.com', password: 'correct horse battery' })
  })

  it('redirects to onboarding when onboarding is not complete', async () => {
    mockFetch({
      'GET /api/auth/status': loggedOut,
      'POST /api/auth/login': authStatus({ user: { ...testUser, onboarding_completed: false } }),
    })
    renderWithProviders(<LoginPage />, {
      route: '/signin',
      path: '/signin',
      extraRoutes: <Route path="/onboarding" element={<div>Onboarding wizard</div>} />,
    })
    await userEvent.type(await screen.findByLabelText(/Email/), 'ada@example.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Onboarding wizard')).toBeInTheDocument()
  })

  it('shows the server error message on failure', async () => {
    mockFetch({
      'GET /api/auth/status': loggedOut,
      'POST /api/auth/login': { status: 400, body: { detail: 'Invalid email or password.' } },
    })
    renderWithProviders(<LoginPage />, { route: '/signin', path: '/signin' })
    await userEvent.type(await screen.findByLabelText(/Email/), 'ada@example.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'))
  })
})
