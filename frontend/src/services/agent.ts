import type {
  AdminUser,
  AgentConfig,
  AgentConfigInput,
  AgentLog,
  AgentTask,
  AnalyticsSummary,
  Diagnostics,
  NotificationList,
  WeeklyReport,
} from '@/types/api'
import { api } from './api'

export const agentService = {
  config: () => api.get<AgentConfig>('/api/agent/config'),
  saveConfig: (body: AgentConfigInput) => api.put<AgentConfig>('/api/agent/config', body),
  run: () => api.post<AgentTask>('/api/agent/run'),
  pause: () => api.post<AgentConfig>('/api/agent/pause'),
  resume: () => api.post<AgentConfig>('/api/agent/resume'),
  tasks: (limit = 30) => api.get<AgentTask[]>('/api/agent/tasks', { limit }),
  task: (id: string) => api.get<AgentTask>(`/api/agent/tasks/${id}`),
  cancel: (id: string) => api.post<AgentTask>(`/api/agent/tasks/${id}/cancel`),
  logs: (params: { task_id?: string; level?: string; limit?: number } = {}) =>
    api.get<AgentLog[]>('/api/agent/logs', params),
}

export const notificationService = {
  list: (params: { unread_only?: boolean; limit?: number } = {}) =>
    api.get<NotificationList>('/api/notifications', params),
  markRead: (id: string) => api.post<void>(`/api/notifications/${id}/read`),
  markAllRead: () => api.post<void>('/api/notifications/read-all'),
}

export const analyticsService = {
  summary: () => api.get<AnalyticsSummary>('/api/analytics/summary'),
  weekly: () => api.get<WeeklyReport>('/api/analytics/weekly-report'),
}

export const systemService = {
  diagnostics: () => api.get<Diagnostics>('/api/diagnostics'),
  exportUrl: '/api/account/export',
  adminUsers: () => api.get<AdminUser[]>('/api/admin/users'),
  adminSetActive: (id: string, active: boolean) => api.post<void>(`/api/admin/users/${id}/active?active=${active}`),
}

/** Converts the server config (which includes read-only fields) into the full PUT body. */
export function toConfigInput(cfg: AgentConfig): AgentConfigInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { paused, authorized_automation_ack_at, last_run_at, next_run_at, effective_weights, ...rest } = cfg
  return { ...rest, acknowledge_authorized_automation: false }
}
