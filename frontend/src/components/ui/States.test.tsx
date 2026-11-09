import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api'
import { EmptyState, ErrorState, LoadingState } from './States'

describe('state components', () => {
  it('ErrorState shows the API error detail and retries', async () => {
    const retry = vi.fn()
    render(<ErrorState error={new ApiError(500, 'Internal server error. Check the server logs.')} onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Internal server error. Check the server logs.')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(retry).toHaveBeenCalled()
  })

  it('EmptyState renders title, description and action', () => {
    render(<EmptyState title="No jobs yet" description="Run discovery." action={<button>Run</button>} />)
    expect(screen.getByRole('heading', { name: 'No jobs yet' })).toBeInTheDocument()
    expect(screen.getByText('Run discovery.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  it('LoadingState is announced as status', () => {
    render(<LoadingState label="Loading jobs…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading jobs…')
  })
})
