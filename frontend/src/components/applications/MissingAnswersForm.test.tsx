import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeApplication } from './fixtures'
import { MissingAnswersForm } from './MissingAnswersForm'

describe('MissingAnswersForm', () => {
  const fields = makeApplication().missing_fields

  it('renders a select for fields with options and a text input otherwise', () => {
    render(<MissingAnswersForm fields={fields} onSubmit={vi.fn()} />)
    const select = screen.getByLabelText(/authorized to work/)
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Notice period/).tagName).toBe('INPUT')
  })

  it('requires every required answer', async () => {
    const onSubmit = vi.fn()
    render(<MissingAnswersForm fields={fields} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save answers' }))
    expect(screen.getAllByText('This answer is required.')).toHaveLength(2)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed answers and the answer-bank preference', async () => {
    const onSubmit = vi.fn()
    render(<MissingAnswersForm fields={fields} onSubmit={onSubmit} />)
    await userEvent.selectOptions(screen.getByLabelText(/authorized to work/), 'Yes')
    await userEvent.type(screen.getByLabelText(/Notice period/), '  30 days ')
    await userEvent.click(screen.getByRole('checkbox', { name: /answer bank/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save answers' }))
    expect(onSubmit).toHaveBeenCalledWith({ q_auth: 'Yes', q_notice: '30 days' }, false)
  })
})
