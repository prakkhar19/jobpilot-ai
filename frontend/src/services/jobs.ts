import type { ImportManualInput, Job, JobDetail, JobPage, JobQuery } from '@/types/api'
import { api } from './api'

export const jobService = {
  list: (q: JobQuery) => api.get<JobPage>('/api/jobs', { ...q }),
  get: (id: string) => api.get<JobDetail>(`/api/jobs/${id}`),
  remove: (id: string) => api.delete(`/api/jobs/${id}`),
  discover: (source_ids?: string[] | null) =>
    api.post<{ task_id: string; state: string }>('/api/jobs/discover', { source_ids: source_ids ?? null }),
  importUrl: (url: string) => api.post<JobDetail>('/api/jobs/import-url', { url }),
  importManual: (body: ImportManualInput) => api.post<JobDetail>('/api/jobs/import-manual', body),
  rematchAll: () => api.post<{ matched: number }>('/api/jobs/rematch'),
  rematch: (id: string) => api.post<JobDetail>(`/api/jobs/${id}/match`),
  aiSummary: (id: string) => api.post<{ summary: string }>(`/api/jobs/${id}/ai-summary`),
  verify: (id: string) => api.post<JobDetail>(`/api/jobs/${id}/verify`),
  findOfficial: (id: string) => api.post<JobDetail>(`/api/jobs/${id}/find-official`),
  hide: (id: string, hidden: boolean) => api.post<Job>(`/api/jobs/${id}/hide?hidden=${hidden}`),
  save: (id: string, note = '') => api.put<void>(`/api/jobs/${id}/save`, { note }),
  unsave: (id: string) => api.delete(`/api/jobs/${id}/save`),
}
