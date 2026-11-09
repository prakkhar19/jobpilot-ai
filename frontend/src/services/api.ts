/**
 * Single fetch wrapper for the JobPilot AI backend.
 *  - same-origin cookies (HttpOnly session cookie is never visible to JS)
 *  - X-CSRF-Token header on every non-GET request (value of the readable `jp_csrf` cookie)
 *  - JSON in/out; errors are thrown as ApiError with `.status` and `.message` (= backend `detail`)
 *  - 401 notifies a registered handler so the app can redirect to /login
 */

export class ApiError extends Error {
  readonly status: number
  readonly errors?: unknown

  constructor(status: number, message: string, errors?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }
}

export const CSRF_COOKIE = 'jp_csrf'

let csrfFallback: string | null = null
let unauthorizedHandler: (() => void) | null = null

/** Remember the CSRF token returned by /auth/status, /auth/login or /auth/register (used if the cookie is unreadable). */
export function setCsrfToken(token: string | null | undefined): void {
  csrfFallback = token ?? null
}

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  for (const part of document.cookie.split(';')) {
    const c = part.trim()
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length))
  }
  return null
}

export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE) ?? csrfFallback
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  signal?: AbortSignal
  /** Do not trigger the global 401 handler (used for the auth status probe and login form). */
  skipAuthRedirect?: boolean
}

export function buildUrl(path: string, query?: Query): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || `Request failed (${res.status})`
  let errors: unknown
  try {
    const data: unknown = await res.json()
    if (data && typeof data === 'object' && 'detail' in data) {
      const detail = (data as { detail: unknown }).detail
      if (typeof detail === 'string') message = detail
      else if (Array.isArray(detail) && detail.length) {
        const first = detail[0] as { msg?: string }
        message = first?.msg ?? message
      }
      errors = (data as { errors?: unknown }).errors
    }
  } catch {
    // non-JSON error body
  }
  if (res.status === 0 || !message) message = 'Network error'
  return new ApiError(res.status, message, errors)
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  if (method !== 'GET') {
    const token = getCsrfToken()
    if (token) headers['X-CSRF-Token'] = token
  }
  let res: Response
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }
  if (!res.ok) {
    const error = await parseError(res)
    if (res.status === 401 && !options.skipAuthRedirect) unauthorizedHandler?.()
    throw error
  }
  if (res.status === 204 || res.status === 205) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, 'method' | 'query'>) =>
    request<T>(path, { ...opts, query }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T = void>(path: string, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
}

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}
