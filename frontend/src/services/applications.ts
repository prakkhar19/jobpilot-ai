import type {
  Application,
  ApplicationEvent,
  ApplicationMode,
  ApplicationPage,
  ApplicationStatuses,
  ApplicationUpdate,
  Interview,
  InterviewInput,
} from '@/types/api'
import { api } from './api'

export const applicationService = {
  statuses: () => api.get<ApplicationStatuses>('/api/applications/statuses'),
  list: (params: { status?: string; q?: string; page?: number; page_size?: number }) =>
    api.get<ApplicationPage>('/api/applications', params),
  get: (id: string) => api.get<Application>(`/api/applications/${id}`),
  track: (job_id: string, status: 'discovered' | 'shortlisted' = 'shortlisted') =>
    api.post<Application>('/api/applications/track', { job_id, status }),
  prepare: (job_id: string, mode: ApplicationMode = 'review') =>
    api.post<Application>('/api/applications/prepare', { job_id, mode }),
  update: (id: string, body: ApplicationUpdate) => api.patch<Application>(`/api/applications/${id}`, body),
  remove: (id: string) => api.delete(`/api/applications/${id}`),
  refresh: (id: string) => api.post<Application>(`/api/applications/${id}/refresh`),
  answers: (id: string, answers: Record<string, string>, save_to_answer_bank = true) =>
    api.post<Application>(`/api/applications/${id}/answers`, { answers, save_to_answer_bank }),
  approve: (id: string) => api.post<Application>(`/api/applications/${id}/approve`),
  submit: (id: string) => api.post<Application>(`/api/applications/${id}/submit`),
  assistedFill: (id: string) => api.post<Application>(`/api/applications/${id}/assisted-fill`),
  markSubmitted: (id: string, note: string, submitted_on: string | null) =>
    api.post<Application>(`/api/applications/${id}/mark-submitted`, { note, submitted_on }),
  setStatus: (id: string, status: string, note = '') =>
    api.post<Application>(`/api/applications/${id}/status`, { status, note }),
  events: (id: string) => api.get<ApplicationEvent[]>(`/api/applications/${id}/events`),
  screenshotUrl: (id: string, which: 'preparation' | 'confirmation', bust?: string) =>
    `/api/applications/${id}/screenshot/${which}${bust ? `?v=${encodeURIComponent(bust)}` : ''}`,
}

export const interviewService = {
  list: (application_id?: string) => api.get<Interview[]>('/api/interviews', { application_id }),
  create: (body: InterviewInput) => api.post<Interview>('/api/interviews', body),
  update: (id: string, body: InterviewInput) => api.put<Interview>(`/api/interviews/${id}`, body),
  remove: (id: string) => api.delete(`/api/interviews/${id}`),
}
