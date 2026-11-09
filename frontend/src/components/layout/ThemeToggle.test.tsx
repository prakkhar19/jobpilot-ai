import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from '@/context/ThemeProvider'
import { THEME_STORAGE_KEY } from '@/context/theme'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  it('toggles the dark class on <html> and persists the choice', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )
    const btn = screen.getByRole('button', { name: 'Switch to dark theme' })
    expect(document.documentElement).not.toHaveClass('dark')
    await userEvent.click(btn)
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('defaults to the OS preference when nothing is stored', () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ ...original(q), matches: q.includes('dark') })) as typeof window.matchMedia
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )
    expect(document.documentElement).toHaveClass('dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
    window.matchMedia = original
  })
})
