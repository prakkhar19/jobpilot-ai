import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeProfile } from '@/components/profile/fixtures.test-data'
import type { ProfileData } from '@/types/api'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import ProfilePage from './ProfilePage'

const summary = {
  id: 'p1', label: 'Primary profile', full_name: 'Ada Lovelace', status: 'draft', is_active: true, version: 1,
  parse_method: 'rules', master_resume_id: 'r1', updated_at: '2026-01-01T00:00:00Z',
}

function setup() {
  const profile = makeProfile()
  return mockFetch({
    'GET /api/profiles': [summary],
    'GET /api/profiles/p1': profile,
    'PUT /api/profiles/p1': ({ body }: { body: unknown }) => ({ ...profile, ...(body as object), version: 2 }),
    'POST /api/profiles/p1/approve': { ...profile, status: 'approved' },
    'GET /api/resumes': [],
    'GET /api/ai-providers': [],
  })
}

describe('ProfilePage / ProfileEditor', () => {
  it('adds and removes experiences and saves the full profile body', async () => {
    const fetchMock = setup()
    renderWithProviders(<ProfilePage />, { route: '/profile' })
    expect(await screen.findByDisplayValue('Analyst')).toBeInTheDocument()
    expect(screen.getByText('Could not detect dates for one role.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove experience 1' }))
    expect(screen.queryByDisplayValue('Analyst')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add experience' }))
    await userEvent.type(screen.getByLabelText('Job title'), 'ML Engineer')
    await userEvent.type(screen.getByLabelText('Company'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Add bullet' }))
    await userEvent.type(screen.getByLabelText('Bullet points 1'), 'Shipped a model')
    await userEvent.click(screen.getByRole('checkbox', { name: 'I currently work here' }))

    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/profiles/p1')).toHaveLength(1))
    const body = callsTo(fetchMock, 'PUT', '/api/profiles/p1')[0].body as ProfileData
    expect(body.experiences).toEqual([
      {
        company: 'Acme', title: 'ML Engineer', location: '', start_date: '', end_date: '', is_current: true,
        bullets: ['Shipped a model'], technologies: [],
      },
    ])
    expect(body.application_facts).toEqual({ 'Notice period': '1 month' })
    expect(body.skills).toEqual([{ name: 'Python', category: 'language' }])
    expect(body.full_name).toBe('Ada Lovelace')
  })

  it('adds skills with a category and application facts', async () => {
    const fetchMock = setup()
    renderWithProviders(<ProfilePage />, { route: '/profile' })
    await screen.findByDisplayValue('Analyst')
    await userEvent.type(screen.getByLabelText('Skill'), 'PyTorch')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'ml')
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }))
    expect(within(screen.getByRole('list', { name: 'Skills' })).getByText('PyTorch')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add fact' }))
    await userEvent.type(screen.getByLabelText('Question 2'), 'Work authorization')
    await userEvent.type(screen.getByLabelText('Answer 2'), 'EU citizen')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/profiles/p1')).toHaveLength(1))
    const body = callsTo(fetchMock, 'PUT', '/api/profiles/p1')[0].body as ProfileData
    expect(body.skills).toContainEqual({ name: 'PyTorch', category: 'ml' })
    expect(body.application_facts).toEqual({ 'Notice period': '1 month', 'Work authorization': 'EU citizen' })
  })

  it('approves a draft profile', async () => {
    const fetchMock = setup()
    renderWithProviders(<ProfilePage />, { route: '/profile' })
    await screen.findByDisplayValue('Analyst')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/profiles/p1/approve')).toHaveLength(1))
  })

  it('shows an empty state when there are no profiles', async () => {
    mockFetch({ 'GET /api/profiles': [], 'GET /api/resumes': [], 'GET /api/ai-providers': [] })
    renderWithProviders(<ProfilePage />, { route: '/profile' })
    expect(await screen.findByText('No profile yet')).toBeInTheDocument()
    expect(await screen.findByText('No uploaded resumes')).toBeInTheDocument()
  })
})
