import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithProviders } from '@/test/utils'
import { summaryFixture } from '@/pages/dashboard/fixtures'
import AnalyticsPage from './AnalyticsPage'

describe('AnalyticsPage', () => {
  it('shows the disclaimer, insights, rates and breakdown table', async () => {
    mockFetch({ 'GET /api/analytics/summary': summaryFixture() })
    renderWithProviders(<AnalyticsPage />)
    expect(await screen.findByText(/no score guarantees an interview or offer/)).toBeInTheDocument()
    expect(screen.getByText("'Backend' roles have your best response rate (50%).")).toBeInTheDocument()
    expect(screen.getByText('36.4%')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Breakdown by source' })).toHaveTextContent('greenhouse')
  })

  it('offers a table view of the funnel', async () => {
    mockFetch({ 'GET /api/analytics/summary': summaryFixture() })
    renderWithProviders(<AnalyticsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Show table for pipeline funnel' }))
    const table = screen.getByRole('table', { name: 'Pipeline funnel' })
    expect(table).toHaveTextContent('Discovered')
    expect(table).toHaveTextContent('128')
  })
})
