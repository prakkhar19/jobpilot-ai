import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makeProfile } from '@/components/profile/fixtures.test-data'
import { authStatus, callsTo, mockFetch, renderWithProviders, testUser } from '@/test/utils'
import OnboardingPage from './OnboardingPage'

const user = { ...testUser, onboarding_completed: false }
const provider = {
  id: 'ai1', name: 'OpenAI', provider: 'openai_compatible', base_url: '', model: 'gpt-4o-mini', embedding_model: '',
  has_api_key: true, api_key_last4: 'abcd', temperature: 0.2, max_tokens: 2000, timeout_seconds: 60, is_default: true,
  is_fallback: false, enabled: true, input_price_per_mtok: null, output_price_per_mtok: null, total_requests: 0,
  total_input_tokens: 0, total_output_tokens: 0, total_errors: 0, estimated_cost_usd: null, last_error: '',
  last_used_at: null, created_at: '2026-01-01T00:00:00Z',
}

function setup(providers: unknown[] = []) {
  const profile = makeProfile()
  return mockFetch({
    'GET /api/auth/status': authStatus({ user }),
    'GET /api/ai-providers': providers,
    'POST /api/resumes': { status: 201, body: { resume: { id: 'r1' }, profile } },
    'GET /api/profiles/active': profile,
    'PATCH /api/auth/me': { ...user, onboarding_completed: true },
  })
}

describe('OnboardingPage — upload step', () => {
  it('uploads the resume as multipart form data and advances to the review step', async () => {
    const fetchMock = setup()
    renderWithProviders(<OnboardingPage />, { route: '/onboarding', path: '/onboarding' })
    expect(await screen.findByRole('heading', { name: 'Upload your resume' })).toBeInTheDocument()
    // No AI provider configured → AI extraction disabled.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Use AI to improve extraction/ })).toBeDisabled())

    const file = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Resume file'), file)
    expect(screen.getByText('cv.pdf')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upload & continue' }))

    expect(await screen.findByRole('heading', { name: 'Review your profile' })).toBeInTheDocument()
    const [call] = callsTo(fetchMock, 'POST', '/api/resumes')
    const fd = call.body as FormData
    expect(fd).toBeInstanceOf(FormData)
    expect((fd.get('file') as File).name).toBe('cv.pdf')
    expect(fd.get('use_llm')).toBe('false')
    expect(fd.get('label')).toBe('')
    expect((call.init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-test')
    // parse warnings from the extracted profile are shown
    expect(screen.getByText('Could not detect dates for one role.')).toBeInTheDocument()
  })

  it('sends use_llm=true when an AI provider is configured and the box is checked', async () => {
    const fetchMock = setup([provider])
    renderWithProviders(<OnboardingPage />, { route: '/onboarding', path: '/onboarding' })
    const box = await screen.findByRole('checkbox', { name: /Use AI to improve extraction/ })
    await waitFor(() => expect(box).toBeEnabled())
    if (box.getAttribute('aria-checked') !== 'true') await userEvent.click(box)
    await userEvent.upload(screen.getByLabelText('Resume file'), new File(['x'], 'cv.docx'))
    await userEvent.click(screen.getByRole('button', { name: 'Upload & continue' }))
    await screen.findByRole('heading', { name: 'Review your profile' })
    const fd = callsTo(fetchMock, 'POST', '/api/resumes')[0].body as FormData
    expect(fd.get('use_llm')).toBe('true')
  })

  it('rejects unsupported file types without uploading', async () => {
    const fetchMock = setup()
    renderWithProviders(<OnboardingPage />, { route: '/onboarding', path: '/onboarding' })
    const input = await screen.findByLabelText('Resume file')
    await userEvent.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false })
    expect(await screen.findByText('Please choose a PDF or DOCX file.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload & continue' })).toBeDisabled()
    expect(callsTo(fetchMock, 'POST', '/api/resumes')).toHaveLength(0)
  })

  it('can skip the whole setup, completing onboarding', async () => {
    const fetchMock = setup()
    renderWithProviders(<OnboardingPage />, {
      route: '/onboarding',
      path: '/onboarding',
      extraRoutes: <Route path="/" element={<div>Dashboard home</div>} />,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Skip setup' }))
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'PATCH', '/api/auth/me')[0].body).toEqual({ onboarding_completed: true })
  })
})
