import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import AgentActivityPage from './AgentActivityPage'

const config = {
  enabled: true, frequency_hours: 24, run_days: [0, 1, 2], window_start_hour: 8, window_end_hour: 20, timezone: 'UTC',
  target_roles: ['Backend Developer'], keywords: [], excluded_keywords: [], locations: ['Berlin'], countries: [],
  workplace_types: ['remote'], experience_levels: [], employment_types: [], salary_min: null, include_companies: [],
  exclude_companies: [], industries: [], required_technologies: [], posted_within_days: null, min_match_score: 65,
  daily_discovery_limit: 200, max_preparations_per_day: 5, auto_generate_documents: true, auto_prepare_applications: false,
  application_mode: 'review', matching_weights: {}, resume_template: 'classic', use_llm: true, paused: false,
  authorized_automation_ack_at: null, last_run_at: null, next_run_at: null, effective_weights: {},
}

const task = (id: string, state: string) => ({
  id, kind: 'pipeline', trigger: 'manual', state, cancel_requested: false, attempt: 1,
  stats: { discovery: { new_jobs: 5, fetched: 40, errors: [] }, matched: 12 }, error: '',
  created_at: '2026-11-09T10:00:00Z', started_at: '2026-11-09T10:00:01Z', finished_at: null, heartbeat_at: null,
})

describe('AgentActivityPage', () => {
  it('renders config, tasks with stats and logs; cancels a running task', async () => {
    const fetchMock = mockFetch({
      'GET /api/agent/config': config,
      'GET /api/agent/tasks': [task('t1', 'MATCHING'), task('t0', 'COMPLETED')],
      'GET /api/agent/logs': [
        { id: 'l1', task_id: 't1', level: 'warning', step: 'discovery', message: 'Source Acme returned 0 jobs', data: {}, created_at: '2026-11-09T10:00:05Z' },
      ],
      'POST /api/agent/tasks/t1/cancel': task('t1', 'MATCHING'),
    })
    renderWithProviders(<AgentActivityPage />)
    expect(await screen.findByText('Backend Developer')).toBeInTheDocument()
    expect(screen.getByText('Live — refreshing every 2 seconds.')).toBeInTheDocument()
    expect(screen.getByText('Matching to your profile')).toBeInTheDocument()
    expect(screen.getAllByText('New jobs')[0]).toBeInTheDocument()
    expect(await screen.findByText('Source Acme returned 0 jobs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run in progress' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/agent/tasks/t1/cancel')).toHaveLength(1))
  })

  it('filters logs by level and pauses the agent', async () => {
    const fetchMock = mockFetch({
      'GET /api/agent/config': config,
      'GET /api/agent/tasks': [],
      'GET /api/agent/logs': [],
      'POST /api/agent/pause': { ...config, paused: true },
    })
    renderWithProviders(<AgentActivityPage />)
    expect(await screen.findByText('No runs yet')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'error')
    await waitFor(() =>
      expect(callsTo(fetchMock, 'GET', '/api/agent/logs').some((c) => c.url.searchParams.get('level') === 'error')).toBe(true),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/agent/pause')).toHaveLength(1))
  })
})
