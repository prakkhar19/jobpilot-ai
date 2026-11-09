import type { AuditEntry, AuthStatus, SessionInfo, User } from '@/types/api'
import { api, setCsrfToken } from './api'

function remember(s: AuthStatus): AuthStatus {
  setCsrfToken(s.csrf_token)
  return s
}

export const authService = {
  status: () => api.get<AuthStatus>('/api/auth/status', undefined, { skipAuthRedirect: true }).then(remember),
  login: (email: string, password: string) =>
    api.post<AuthStatus>('/api/auth/login', { email, password }, { skipAuthRedirect: true }).then(remember),
  register: (email: string, password: string, full_name: string) =>
    api.post<AuthStatus>('/api/auth/register', { email, password, full_name }, { skipAuthRedirect: true }).then(remember),
  logout: () => api.post<void>('/api/auth/logout', undefined, { skipAuthRedirect: true }),
  me: () => api.get<User>('/api/auth/me'),
  updateMe: (body: { full_name?: string; onboarding_completed?: boolean }) => api.patch<User>('/api/auth/me', body),
  changePassword: (current_password: string, new_password: string) =>
    api.post<void>('/api/auth/change-password', { current_password, new_password }),
  requestReset: (email: string) =>
    api.post<{ detail: string }>('/api/auth/password-reset/request', { email }, { skipAuthRedirect: true }),
  confirmReset: (token: string, new_password: string) =>
    api.post<void>('/api/auth/password-reset/confirm', { token, new_password }, { skipAuthRedirect: true }),
  sessions: () => api.get<SessionInfo[]>('/api/auth/sessions'),
  revokeSession: (id: string) => api.delete(`/api/auth/sessions/${id}`),
  revokeOthers: () => api.post<void>('/api/auth/sessions/revoke-others'),
  deleteAccount: (password: string, confirm: string) =>
    api.post<void>('/api/auth/delete-account', { password, confirm }),
  auditLog: (limit = 100) => api.get<AuditEntry[]>('/api/audit-log', { limit }),
}
