import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { authStatus, callsTo, mockFetch, renderWithProviders } from '@/test/utils'
import IntegrationsPage from './IntegrationsPage'

const catalog = {
  supported: [
    { kind: 'greenhouse', label: 'Greenhouse job board', description: 'Public boards API', identifier_help: "Board token, e.g. 'gitlab'" },
    { kind: 'lever', label: 'Lever job board', description: '', identifier_help: 'Company slug' },
    { kind: 'demo', label: 'Demo sandbox board', description: '', identifier_help: "Use 'sandbox'" },
  ],
  unsupported: [{ platform: 'linkedin', reason: 'LinkedIn prohibits automated scraping.' }],
}
const source = {
  id: 's1', kind: 'greenhouse', identifier: 'gitlab', display_name: 'GitLab', enabled: true, last_checked_at: null,
  last_status: '', last_error: '', jobs_found: 0, created_at: '2026-01-01T00:00:00Z',
}
const provider = {
  id: 'ai1', name: 'NIM', provider: 'openai_compatible', base_url: 'https://integrate.api.nvidia.com/v1', model: 'nemotron',
  embedding_model: '', has_api_key: true, api_key_last4: 'wxyz', temperature: 0.2, max_tokens: 2000, timeout_seconds: 60,
  is_default: true, is_fallback: false, enabled: true, input_price_per_mtok: 1, output_price_per_mtok: 2, total_requests: 12,
  total_input_tokens: 3400, total_output_tokens: 900, total_errors: 1, estimated_cost_usd: 0.0052, last_error: 'timeout',
  last_used_at: null, created_at: '2026-01-01T00:00:00Z',
}

describe('IntegrationsPage', () => {
  it('adds a job source from the catalog and tests it', async () => {
    let sources: unknown[] = []
    const fetchMock = mockFetch({
      'GET /api/sources': () => sources,
      'GET /api/sources/catalog': catalog,
      'POST /api/sources': () => {
        sources = [source]
        return { status: 201, body: source }
      },
      'POST /api/sources/s1/test': { ok: true, message: 'Board reachable', job_count: 42 },
    })
    renderWithProviders(<IntegrationsPage />, { route: '/integrations?tab=sources' })
    expect(await screen.findByText('No job sources yet')).toBeInTheDocument()
    expect(await screen.findByText('LinkedIn prohibits automated scraping.')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: /Add source/ })[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('option', { name: 'Demo sandbox board' })).not.toBeInTheDocument()
    expect(within(dialog).getByText("Board token, e.g. 'gitlab'")).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add source' }))
    expect(await within(dialog).findByText('Identifier is required.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(/Identifier/), 'gitlab')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add source' }))

    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/sources')).toHaveLength(1))
    expect(callsTo(fetchMock, 'POST', '/api/sources')[0].body).toEqual({
      kind: 'greenhouse', identifier: 'gitlab', display_name: '', enabled: true,
    })
    expect(await screen.findByText('GitLab')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText(/Board reachable \(42 open jobs\)/)).toBeInTheDocument()
  })

  it('offers the one-click demo sandbox in demo mode', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/status': authStatus({ demo_mode: true }),
      'GET /api/sources': [],
      'GET /api/sources/catalog': catalog,
      'POST /api/sources': { status: 201, body: { ...source, kind: 'demo', identifier: 'sandbox' } },
    })
    renderWithProviders(<IntegrationsPage />, { route: '/integrations?tab=sources' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add demo sandbox' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/sources')).toHaveLength(1))
    expect(callsTo(fetchMock, 'POST', '/api/sources')[0].body).toMatchObject({ kind: 'demo', identifier: 'sandbox' })
  })

  it('shows provider usage and tests the connection', async () => {
    const fetchMock = mockFetch({
      'GET /api/ai-providers': [provider],
      'POST /api/ai-providers/ai1/test': { ok: true, message: "Connected. Model replied: 'OK'", latency_ms: 321, model: 'nemotron' },
    })
    renderWithProviders(<IntegrationsPage />, { route: '/integrations' })
    expect(await screen.findByText('NIM')).toBeInTheDocument()
    expect(screen.getByText('$0.0052')).toBeInTheDocument()
    expect(screen.getByText('timeout')).toBeInTheDocument()
    expect(screen.getByText(/stored \(…wxyz\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Test connection/ }))
    expect(await screen.findByText('321 ms')).toBeInTheDocument()
    expect(screen.getAllByText("Connected. Model replied: 'OK'").length).toBeGreaterThan(0)
    expect(callsTo(fetchMock, 'POST', '/api/ai-providers/ai1/test')).toHaveLength(1)
  })

  it('does not send the API key when editing without typing a new one', async () => {
    const fetchMock = mockFetch({
      'GET /api/ai-providers': [provider],
      'GET /api/ai-providers/catalog': {
        openai_compatible: { label: 'OpenAI-compatible', requires_key: false, default_base_url: 'https://api.openai.com/v1', examples: [] },
        anthropic: { label: 'Anthropic (Claude)', requires_key: true, default_base_url: 'https://api.anthropic.com', examples: [] },
      },
      'PUT /api/ai-providers/ai1': provider,
    })
    renderWithProviders(<IntegrationsPage />, { route: '/integrations' })
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for NIM' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Leave blank to keep it/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/ai-providers/ai1')).toHaveLength(1))
    const body = callsTo(fetchMock, 'PUT', '/api/ai-providers/ai1')[0].body as Record<string, unknown>
    expect(body).not.toHaveProperty('api_key')
    expect(body).toMatchObject({ name: 'NIM', model: 'nemotron', is_default: true })
  })
})
