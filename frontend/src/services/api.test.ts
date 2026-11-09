import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, buildUrl, onUnauthorized, request, setCsrfToken } from './api'
import { jsonResponse } from '@/test/utils'

describe('api wrapper', () => {
  it('sends the CSRF header from the jp_csrf cookie on POST, with same-origin credentials', async () => {
    document.cookie = 'jp_csrf=cookie-token; path=/'
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await api.post('/api/things', { a: 1 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/things')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    const headers = init.headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('cookie-token')
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('falls back to the token returned by the auth endpoints when the cookie is missing', async () => {
    setCsrfToken('fallback-token')
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await api.delete('/api/x/1')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('fallback-token')
    setCsrfToken(null)
  })

  it('does not send a CSRF header on GET', async () => {
    document.cookie = 'jp_csrf=cookie-token; path=/'
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    await api.get('/api/list', { q: 'x', empty: '', none: null, page: 2 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/list?q=x&page=2')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined()
  })

  it('throws ApiError with status and detail message on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'This source is already configured.' }, 409)))
    const err = await request('/api/sources', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe('This source is already configured.')
  })

  it('keeps 422 validation errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ detail: 'email: invalid', errors: [{ loc: ['body', 'email'], msg: 'invalid' }] }, 422)),
    )
    const err = (await api.post('/api/auth/login', {}).catch((e: unknown) => e)) as ApiError
    expect(err.status).toBe(422)
    expect(err.message).toBe('email: invalid')
    expect(err.errors).toHaveLength(1)
  })

  it('calls the unauthorized handler on 401 unless suppressed', async () => {
    const handler = vi.fn()
    onUnauthorized(handler)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'Not authenticated' }, 401)))
    await expect(api.get('/api/jobs')).rejects.toMatchObject({ status: 401, message: 'Not authenticated' })
    expect(handler).toHaveBeenCalledTimes(1)
    await expect(api.get('/api/auth/status', undefined, { skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
    onUnauthorized(null)
  })

  it('returns undefined for 204 responses and sends FormData without a JSON content type', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const fd = new FormData()
    fd.append('file', new Blob(['x']), 'cv.pdf')
    await expect(api.post('/api/resumes', fd)).resolves.toBeUndefined()
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.body).toBe(fd)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('maps network failures to ApiError(0)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(api.get('/api/x')).rejects.toMatchObject({ status: 0 })
  })

  it('buildUrl appends to existing query strings', () => {
    expect(buildUrl('/api/jobs/1/hide?hidden=true', { a: 1 })).toBe('/api/jobs/1/hide?hidden=true&a=1')
  })
})
