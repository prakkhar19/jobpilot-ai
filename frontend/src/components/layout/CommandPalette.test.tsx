import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithProviders } from '@/test/utils'
import { CommandPalette } from './CommandPalette'

describe('CommandPalette', () => {
  it('opens with Ctrl+K and jumps to a page with Enter', async () => {
    mockFetch({})
    renderWithProviders(<CommandPalette />, {
      path: '/',
      extraRoutes: <Route path="/applications" element={<div>Applications screen</div>} />,
    })
    await userEvent.keyboard('{Control>}k{/Control}')
    const input = await screen.findByRole('combobox', { name: 'Command' })
    await userEvent.type(input, 'applic')
    expect(screen.getByRole('option', { name: /Applications/ })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(await screen.findByText('Applications screen')).toBeInTheDocument()
  })

  it('offers a job search for any text', async () => {
    mockFetch({})
    renderWithProviders(<CommandPalette />, { path: '/', extraRoutes: <Route path="/jobs" element={<div>Jobs screen</div>} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
    await userEvent.type(await screen.findByRole('combobox', { name: 'Command' }), 'react{Enter}')
    expect(await screen.findByText('Jobs screen')).toBeInTheDocument()
  })
})
