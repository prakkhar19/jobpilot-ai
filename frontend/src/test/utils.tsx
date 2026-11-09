import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { vi, type Mock } from 'vitest'
import { AuthProvider } from '@/context/AuthProvider'
import { ThemeProvider } from '@/context/ThemeProvider'
import type { AuthStatus, User } from '@/types/api'

export const testUser: User = {
  id: 'u1',
  email: 'ada@example.com',
  full_name: 'Ada Lovelace',
  role: 'user',
  onboarding_completed: true,
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: null,
}

export function authStatus(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    user: testUser,
    csrf_token: 'csrf-test',
    registration_open: true,
    single_user_mode: false,
    demo_mode: false,
    ...overrides,
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = unknown | ((req: { url: URL; method: string; body: unknown; init?: RequestInit }) => unknown)

export interface MockRoute {
  status?: number
  body?: Handler
}

/**
 * Stubs global fetch. Keys are "METHOD /path" (query string ignored). Values are either a response body,
 * a function receiving the request, or {status, body}. Unmatched requests return 404.
 * The /api/auth/status endpoint defaults to a signed-in user unless overridden.
 */
export function mockFetch(routes: Record<string, Handler | MockRoute>): Mock {
  const all: Record<string, Handler | MockRoute> = { 'GET /api/auth/status': authStatus(), ...routes }
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url.pathname}`
    let entry = all[key]
    if (entry === undefined) {
      // allow simple :param wildcards, e.g. "GET /api/jobs/:id"
      const match = Object.keys(all).find((k) => {
        const [m, p] = k.split(' ')
        if (m !== method || !p.includes(':')) return false
        const re = new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$')
        return re.test(url.pathname)
      })
      entry = match ? all[match] : undefined
    }
    if (entry === undefined) return jsonResponse({ detail: `No mock for ${key}` }, 404)
    let body: unknown = undefined
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    } else if (init?.body) body = init.body
    const isRoute = entry !== null && typeof entry === 'object' && ('status' in (entry as object) || 'body' in (entry as object)) && Object.keys(entry as object).every((k) => k === 'status' || k === 'body')
    const status = isRoute ? ((entry as MockRoute).status ?? 200) : 200
    const handler = isRoute ? (entry as MockRoute).body : entry
    const result = typeof handler === 'function' ? await (handler as (r: unknown) => unknown)({ url, method, body, init }) : handler
    if (result instanceof Response) return result
    return jsonResponse(result, status)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Returns the parsed JSON bodies of calls matching method + path. */
export function callsTo(fetchMock: Mock, method: string, path: string): { url: URL; body: unknown; init?: RequestInit }[] {
  return fetchMock.mock.calls
    .map(([input, init]) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      return { url: new URL(raw, 'http://localhost'), init: init as RequestInit | undefined }
    })
    .filter(({ url, init }) => (init?.method ?? 'GET').toUpperCase() === method && url.pathname === path)
    .map(({ url, init }) => {
      let body: unknown = init?.body
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body)
        } catch {
          // keep string
        }
      }
      return { url, body, init }
    })
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity }, mutations: { retry: false } },
  })
}

interface RenderOptions {
  route?: string
  /** Route pattern for the element, e.g. "/jobs/:jobId". Defaults to "*". */
  path?: string
  extraRoutes?: ReactNode
  queryClient?: QueryClient
}

export function renderWithProviders(ui: ReactElement, opts: RenderOptions = {}): RenderResult & { queryClient: QueryClient } {
  const queryClient = opts.queryClient ?? createTestQueryClient()
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[opts.route ?? '/']}>
          <AuthProvider>
            <Routes>
              <Route path={opts.path ?? '*'} element={ui} />
              {opts.extraRoutes}
              <Route path="/login" element={<div>Login screen</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return { ...result, queryClient }
}
