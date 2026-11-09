import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeApplication, statusesFixture } from '@/components/applications/fixtures'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import ApplicationsPage from './ApplicationsPage'

const empty = { items: [], total: 0, page: 1, page_size: 25 }

describe('ApplicationsPage', () => {
  it('renders the empty state', async () => {
    mockFetch({ 'GET /api/applications/statuses': statusesFixture, 'GET /api/applications': empty })
    renderWithProviders(<ApplicationsPage />, { route: '/applications' })
    expect(await screen.findByText('No applications yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse jobs' })).toHaveAttribute('href', '/jobs')
  })

  it('renders the error state with retry', async () => {
    mockFetch({
      'GET /api/applications/statuses': statusesFixture,
      'GET /api/applications': { status: 500, body: { detail: 'Internal server error. Check the server logs.' } },
    })
    renderWithProviders(<ApplicationsPage />, { route: '/applications' })
    expect(await screen.findByText('Internal server error. Check the server logs.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('applies the status filter from the URL and toggles chips', async () => {
    const fetchMock = mockFetch({
      'GET /api/applications/statuses': statusesFixture,
      'GET /api/applications': { ...empty, items: [makeApplication()], total: 1 },
    })
    renderWithProviders(<ApplicationsPage />, { route: '/applications?status=awaiting_approval,needs_input' })
    expect((await screen.findAllByRole('link', { name: 'ML Engineer' })).length).toBeGreaterThan(0)
    expect(callsTo(fetchMock, 'GET', '/api/applications')[0].url.searchParams.get('status')).toBe('awaiting_approval,needs_input')
    expect(screen.getByRole('button', { name: 'Awaiting approval' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Awaiting approval' }))
    await waitFor(() => {
      const calls = callsTo(fetchMock, 'GET', '/api/applications')
      expect(calls[calls.length - 1].url.searchParams.get('status')).toBe('needs_input')
    })
  })

  it('deletes after confirmation', async () => {
    const fetchMock = mockFetch({
      'GET /api/applications/statuses': statusesFixture,
      'GET /api/applications': { ...empty, items: [makeApplication()], total: 1 },
      'DELETE /api/applications/app1': { status: 204 },
    })
    renderWithProviders(<ApplicationsPage />, { route: '/applications' })
    const [btn] = await screen.findAllByRole('button', { name: /Delete application for ML Engineer/ })
    await userEvent.click(btn)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(callsTo(fetchMock, 'DELETE', '/api/applications/app1')).toHaveLength(1))
  })
})
