import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeApplication } from '@/components/applications/fixtures'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import InterviewsPage from './InterviewsPage'

const submitted = makeApplication({ id: 'app9', status: 'submitted', job_title: 'Data Engineer', company: 'Globex' })

describe('InterviewsPage', () => {
  it('shows the empty state', async () => {
    mockFetch({ 'GET /api/interviews': [] })
    renderWithProviders(<InterviewsPage />, { route: '/interviews' })
    expect(await screen.findByText('No interviews yet')).toBeInTheDocument()
  })

  it('requires an application and creates an interview', async () => {
    const fetchMock = mockFetch({
      'GET /api/interviews': [],
      'GET /api/applications': { items: [submitted], total: 1, page: 1, page_size: 100 },
      'POST /api/interviews': {
        status: 201,
        body: {
          id: 'iv1', application_id: 'app9', scheduled_at: null, kind: 'technical', location: '', interviewers: '',
          status: 'scheduled', outcome: '', notes: '', created_at: '2026-11-01T00:00:00Z', company: 'Globex', job_title: 'Data Engineer',
        },
      },
    })
    renderWithProviders(<InterviewsPage />, { route: '/interviews' })
    await userEvent.click((await screen.findAllByRole('button', { name: /Add interview/ }))[0])
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add interview' }))
    expect(await within(dialog).findByText('Select the application this interview belongs to.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/interviews')).toHaveLength(0)

    // only submitted applications are requested
    const listCall = callsTo(fetchMock, 'GET', '/api/applications')[0]
    expect(listCall.url.searchParams.get('status')).toContain('submitted')
    expect(listCall.url.searchParams.get('status')).not.toContain('needs_input')

    await within(dialog).findByRole('option', { name: 'Data Engineer — Globex' })
    await userEvent.selectOptions(within(dialog).getByLabelText(/Application/), 'app9')
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'technical')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add interview' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/interviews')).toHaveLength(1))
    expect(callsTo(fetchMock, 'POST', '/api/interviews')[0].body).toMatchObject({
      application_id: 'app9',
      kind: 'technical',
      status: 'scheduled',
      scheduled_at: null,
    })
  })

  it('opens the dialog preselected from ?application=', async () => {
    mockFetch({ 'GET /api/interviews': [], 'GET /api/applications': { items: [submitted], total: 1, page: 1, page_size: 100 } })
    renderWithProviders(<InterviewsPage />, { route: '/interviews?application=app9' })
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('option', { name: 'Data Engineer — Globex' })
    expect(within(dialog).getByLabelText(/Application/)).toHaveValue('app9')
  })
})
