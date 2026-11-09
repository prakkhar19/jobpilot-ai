import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeApplication, statusesFixture } from '@/components/applications/fixtures'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import ApplicationDetailPage from './ApplicationDetailPage'

const base = {
  'GET /api/applications/statuses': statusesFixture,
  'GET /api/applications/app1/events': [],
  'GET /api/resume-versions': [],
  'GET /api/cover-letters': [],
}

describe('ApplicationDetailPage', () => {
  it('submits missing answers to POST /answers and shows the updated status', async () => {
    const fetchMock = mockFetch({
      ...base,
      'GET /api/applications/app1': makeApplication(),
      'POST /api/applications/app1/answers': makeApplication({
        status: 'awaiting_approval',
        missing_fields: [],
        answers: {
          first_name: { value: 'Ada', source: 'profile' },
          q_auth: { value: 'No', source: 'user' },
          q_notice: { value: '2 weeks', source: 'user' },
        },
        updated_at: '2026-11-03T10:00:00Z',
      }),
    })
    renderWithProviders(<ApplicationDetailPage />, { route: '/applications/app1', path: '/applications/:appId' })
    const form = await screen.findByRole('form', { name: 'Answer required questions' })
    await userEvent.selectOptions(within(form).getByLabelText(/authorized to work/), 'No')
    await userEvent.type(within(form).getByLabelText(/Notice period/), '2 weeks')
    await userEvent.click(within(form).getByRole('button', { name: 'Save answers' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/applications/app1/answers')).toHaveLength(1))
    const [call] = callsTo(fetchMock, 'POST', '/api/applications/app1/answers')
    expect(call.body).toEqual({ answers: { q_auth: 'No', q_notice: '2 weeks' }, save_to_answer_bank: true })
    expect((call.init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-test')
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Answer required questions' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Approve/ })).toBeEnabled()
  })

  it('shows Submit only when the provider supports automated submission', async () => {
    mockFetch({ ...base, 'GET /api/applications/app1': makeApplication({ status: 'ready_to_submit', missing_fields: [] }) })
    renderWithProviders(<ApplicationDetailPage />, { route: '/applications/app1', path: '/applications/:appId' })
    expect(await screen.findByRole('button', { name: /Assisted fill/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Submit$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open application page/ })).toHaveAttribute('href', 'https://boards.greenhouse.io/acme/jobs/1')
  })

  it('confirms before submitting and shows the last error banner', async () => {
    const fetchMock = mockFetch({
      ...base,
      'GET /api/applications/app1': makeApplication({
        status: 'ready_to_submit',
        missing_fields: [],
        last_error: 'CAPTCHA detected',
        provider_capabilities: { automated_submit: true, assisted_fill: false, inspection: true, label: 'Sandbox' },
      }),
      'POST /api/applications/app1/submit': { status: 202, body: makeApplication({ status: 'submitted', missing_fields: [] }) },
    })
    renderWithProviders(<ApplicationDetailPage />, { route: '/applications/app1', path: '/applications/:appId' })
    expect(await screen.findByText('CAPTCHA detected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Submit$/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit application' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/applications/app1/submit')).toHaveLength(1))
  })

  it('shows not found for a 404', async () => {
    mockFetch({ ...base, 'GET /api/applications/app1': { status: 404, body: { detail: 'Application not found' } } })
    renderWithProviders(<ApplicationDetailPage />, { route: '/applications/app1', path: '/applications/:appId' })
    expect(await screen.findByText('Application not found')).toBeInTheDocument()
  })
})
