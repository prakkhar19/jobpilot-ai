import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { CoverLetter } from '@/types/api'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import CoverLetterStudioPage from './CoverLetterStudioPage'

const letter: CoverLetter = {
  id: 'cl1',
  job_id: 'job1',
  version_number: 1,
  content: 'Dear hiring team,\n\nI am excited.',
  generation_method: 'llm',
  provider: 'openai_compatible',
  model: 'gpt-4o-mini',
  fact_check: { removed_sentences: ['I led a team of 40 at NASA — mentions NASA'], note: '' },
  edited_by_user: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

describe('CoverLetterStudioPage', () => {
  it('shows the letter, removed sentences and download links, and saves edits', async () => {
    const fetchMock = mockFetch({
      'GET /api/cover-letters': [letter],
      'GET /api/cover-letters/cl1': letter,
      'GET /api/jobs': { items: [], total: 0, page: 1, page_size: 100 },
      'PUT /api/cover-letters/cl1': (req: { body: { content: string } }) => ({
        ...letter,
        content: req.body.content,
        edited_by_user: true,
        updated_at: '2026-11-02T00:00:00Z',
      }),
    })
    renderWithProviders(<CoverLetterStudioPage />, { route: '/cover-letters/cl1', path: '/cover-letters/:letterId' })
    const textarea = await screen.findByLabelText('Cover letter text')
    expect(textarea).toHaveValue('Dear hiring team,\n\nI am excited.')
    expect(screen.getByText('I led a team of 40 at NASA — mentions NASA')).toBeInTheDocument()
    for (const fmt of ['pdf', 'docx', 'txt']) {
      expect(screen.getByRole('link', { name: fmt.toUpperCase() })).toHaveAttribute('href', `/api/cover-letters/cl1/download/${fmt}`)
    }
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await userEvent.type(textarea, ' Thanks!')
    await userEvent.click(save)
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/cover-letters/cl1')).toHaveLength(1))
    expect(callsTo(fetchMock, 'PUT', '/api/cover-letters/cl1')[0].body).toEqual({ content: 'Dear hiring team,\n\nI am excited. Thanks!' })
    expect(await screen.findByText('Edited by you')).toBeInTheDocument()
  })

  it('shows an error state when the list fails', async () => {
    mockFetch({
      'GET /api/cover-letters': { status: 500, body: { detail: 'boom' } },
      'GET /api/jobs': { items: [], total: 0, page: 1, page_size: 100 },
    })
    renderWithProviders(<CoverLetterStudioPage />, { route: '/cover-letters', path: '/cover-letters' })
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
