import type { Application, ApplicationStatuses } from '@/types/api'

export function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app1',
    job_id: 'job1',
    status: 'needs_input',
    mode: 'review',
    provider: 'greenhouse',
    resume_version_id: 'rv1',
    cover_letter_id: null,
    match_score: 72,
    form_fields: [
      { name: 'first_name', label: 'First name', type: 'text', required: true, options: [], kind: 'standard' },
      { name: 'q_auth', label: 'Are you authorized to work in the US?', type: 'select', required: true, options: ['Yes', 'No'], kind: 'question' },
      { name: 'q_notice', label: 'Notice period', type: 'text', required: true, options: [], kind: 'question' },
    ],
    answers: { first_name: { value: 'Ada', source: 'profile' } },
    missing_fields: [
      { name: 'q_auth', label: 'Are you authorized to work in the US?', type: 'select', required: true, options: ['Yes', 'No'], kind: 'question' },
      { name: 'q_notice', label: 'Notice period', type: 'text', required: true, options: [], kind: 'question' },
    ],
    preparation_screenshot: '',
    approved_at: null,
    submitted_at: null,
    submitted_by: '',
    confirmation_text: '',
    confirmation_screenshot: '',
    submit_attempts: 0,
    last_error: '',
    notes: '',
    follow_up_date: null,
    busy: false,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-02T10:00:00Z',
    company: 'Acme',
    job_title: 'ML Engineer',
    job_url: 'https://boards.greenhouse.io/acme/jobs/1',
    source_kind: 'greenhouse',
    is_demo: false,
    provider_capabilities: { key: 'greenhouse', label: 'Greenhouse', inspection: true, assisted_fill: true, automated_submit: false, note: '' },
    ...overrides,
  }
}

export const statusesFixture: ApplicationStatuses = {
  statuses: [
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'needs_input', label: 'Needs your input' },
    { key: 'awaiting_approval', label: 'Awaiting approval' },
    { key: 'submitted', label: 'Submitted' },
  ],
  manual: ['shortlisted', 'under_review', 'rejected', 'withdrawn'],
  providers: [],
}
