import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithProviders } from '@/test/utils'
import { FormQuestions } from './FormQuestions'

describe('FormQuestions', () => {
  it('sends the pasted questions and shows each answer, flagging ones only the user can answer', async () => {
    let sent = ''
    mockFetch({
      'POST /api/apply-queue/:id/answers': ({ body }: { body: { questions: string } }) => {
        sent = body.questions
        return [
          { question: 'Relevant experience *', answer: 'I work as a Software Engineer at Acme.', method: 'template', note: '' },
          { question: 'Expected CTC? *', answer: '', method: 'needs_you', note: 'Only you can answer this one.' },
        ]
      },
    })
    renderWithProviders(<FormQuestions jobId="j1" company="Acme" />)
    await userEvent.click(screen.getByText('Questions on the application form?'))
    await userEvent.type(screen.getByLabelText(/Paste the questions Acme asks/), 'Relevant experience *')
    await userEvent.click(screen.getByRole('button', { name: 'Write my answers' }))
    expect(await screen.findByText('I work as a Software Engineer at Acme.')).toBeInTheDocument()
    expect(screen.getByText('Only you can answer this one.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Copy answer/ })).toHaveLength(1)
    expect(sent).toBe('Relevant experience *')
  })
})
