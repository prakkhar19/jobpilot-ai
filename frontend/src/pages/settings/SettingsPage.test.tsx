import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { normalizedPercents } from '@/components/settings/weights'
import { callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import type { AgentConfigInput } from '@/types/api'
import { agentConfig } from './fixtures'
import SettingsPage from './SettingsPage'

const templates = { templates: [{ key: 'classic', name: 'Classic', description: 'ATS-safe.' }], target_roles: [] }

describe('SettingsPage', () => {
  it('requires an explicit acknowledgement before enabling authorized mode and sends it on save', async () => {
    const fetchMock = mockFetch({
      'GET /api/agent/config': agentConfig,
      'GET /api/resume-templates': templates,
      'PUT /api/agent/config': ({ body }: { body: unknown }) => ({
        ...agentConfig,
        ...(body as object),
        authorized_automation_ack_at: '2026-11-10T00:00:00Z',
      }),
    })
    renderWithProviders(<SettingsPage />)
    await userEvent.click(await screen.findByRole('radio', { name: /Authorized automation/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Enable authorized automation?' })
    const confirm = within(dialog).getByRole('button', { name: 'Enable authorized mode' })
    expect(confirm).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('radio', { name: /Authorized automation/ })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: /Save settings/ }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/agent/config')).toHaveLength(1))
    const body = callsTo(fetchMock, 'PUT', '/api/agent/config')[0].body as AgentConfigInput
    expect(body.application_mode).toBe('authorized')
    expect(body.acknowledge_authorized_automation).toBe(true)
    // sends the full object, without read-only fields
    expect(body.target_roles).toEqual(['ML Engineer'])
    expect(body).not.toHaveProperty('effective_weights')
    expect(body).not.toHaveProperty('paused')
    expect(Object.keys(body.matching_weights)).toHaveLength(7)
  })

  it('cancelling the dialog keeps the previous mode', async () => {
    mockFetch({ 'GET /api/agent/config': agentConfig, 'GET /api/resume-templates': templates })
    renderWithProviders(<SettingsPage />)
    await userEvent.click(await screen.findByRole('radio', { name: /Authorized automation/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('radio', { name: /^Review/ })).toBeChecked()
  })

  it('shows an error state when the config fails to load', async () => {
    mockFetch({ 'GET /api/agent/config': { status: 500, body: { detail: 'Database unavailable' } } })
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
  })

  it('normalizes weights to 100%', () => {
    const pct = normalizedPercents({ a: 1, b: 1, c: 2 })
    expect(pct).toEqual({ a: 25, b: 25, c: 50 })
    expect(normalizedPercents({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 })
  })
})
