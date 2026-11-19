import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithProviders } from '@/test/utils'
import type { ApplyQueueItem } from '@/types/api'
import ApplyModePage from './ApplyModePage'

const item = (over: Partial<ApplyQueueItem> = {}): ApplyQueueItem => ({
  job_id: 'j1', title: 'Full Stack Developer', company: 'Acme', location: 'Noida', workplace_type: 'onsite',
  source_kind: 'email_alerts', match_score: 72, apply_url: 'https://example.com/apply/1',
  discovered_at: '2026-11-16T10:00:00Z', application_id: 'a1', resume_version_id: 'r1', cover_letter_id: 'c1',
  cover_letter: 'Dear Hiring Team, ...', ...over,
})

describe('ApplyModePage', () => {
  it('shows the job with its documents and records an application', async () => {
    const calls: string[] = []
    mockFetch({
      'GET /api/apply-queue': { items: [item(), item({ job_id: 'j2', title: 'MERN Developer' })], total: 2, applied_today: 0, min_score: 60 },
      'POST /api/apply-queue/:id/applied': ({ url }: { url: URL }) => {
        calls.push(url.pathname)
        return { status: 204 }
      },
    })
    renderWithProviders(<ApplyModePage />)
    expect(await screen.findByRole('link', { name: 'Full Stack Developer' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the job/ })).toHaveAttribute('href', 'https://example.com/apply/1')
    expect(screen.getByRole('link', { name: /Download my tailored resume/ })).toHaveAttribute('href', '/api/resume-versions/r1/download/pdf')
    await userEvent.click(screen.getByRole('button', { name: /I applied/ }))
    expect(await screen.findByRole('link', { name: 'MERN Developer' })).toBeInTheDocument()
    expect(calls).toEqual(['/api/apply-queue/j1/applied'])
    expect(screen.getByText('Today: 1 applied')).toBeInTheDocument()
  })

  it('prepares missing documents automatically', async () => {
    mockFetch({
      'GET /api/apply-queue': { items: [item({ resume_version_id: null, cover_letter_id: null, cover_letter: '' })], total: 1, applied_today: 0, min_score: 60 },
      'POST /api/apply-queue/:id/prepare': item({ resume_version_id: 'r9' }),
    })
    renderWithProviders(<ApplyModePage />)
    expect(await screen.findByRole('link', { name: /Download my tailored resume/ })).toHaveAttribute('href', '/api/resume-versions/r9/download/pdf')
  })

  it('celebrates when the queue is empty', async () => {
    mockFetch({ 'GET /api/apply-queue': { items: [], total: 0, applied_today: 4, min_score: 60 } })
    renderWithProviders(<ApplyModePage />)
    expect(await screen.findByText('All caught up!')).toBeInTheDocument()
    expect(screen.getByText('Today: 4 applied')).toBeInTheDocument()
  })
})

describe('referral helpers', () => {
  it('writes a short note that fits a LinkedIn connection request', async () => {
    const { referralMessage, peopleSearchUrl } = await import('@/utils/referral')
    const msg = referralMessage('Asha', { title: 'Backend Developer', company: 'Acme & Co' })
    expect(msg).toContain("I'm Asha.")
    expect(msg).toContain('Backend Developer role at Acme & Co')
    expect(msg.length).toBeLessThanOrEqual(300)
    expect(referralMessage('', { title: 'X', company: 'Y' })).not.toContain("I'm .")
    expect(peopleSearchUrl('Acme & Co')).toBe('https://www.linkedin.com/search/results/people/?keywords=Acme%20%26%20Co')
  })
})
