import type {
  CoverLetter,
  ResumeCompare,
  ResumeContent,
  ResumeGenerateInput,
  ResumeTemplatesResponse,
  ResumeVersion,
  ResumeVersionSummary,
} from '@/types/api'
import { api } from './api'

export const resumeService = {
  templates: () => api.get<ResumeTemplatesResponse>('/api/resume-templates'),
  list: (job_id?: string) => api.get<ResumeVersionSummary[]>('/api/resume-versions', { job_id }),
  get: (id: string) => api.get<ResumeVersion>(`/api/resume-versions/${id}`),
  generate: (body: ResumeGenerateInput) => api.post<ResumeVersion>('/api/resume-versions', body),
  remove: (id: string) => api.delete(`/api/resume-versions/${id}`),
  compare: (id: string) => api.get<ResumeCompare>(`/api/resume-versions/${id}/compare`),
  edit: (id: string, content: ResumeContent, template?: string | null) =>
    api.post<ResumeVersion>(`/api/resume-versions/${id}/edit`, { content, template: template ?? null }),
  downloadUrl: (id: string, fmt: 'pdf' | 'docx') => `/api/resume-versions/${id}/download/${fmt}`,
  previewUrl: (id: string) => `/api/resume-versions/${id}/download/pdf?inline=true`,
}

export const coverLetterService = {
  list: (job_id?: string) => api.get<CoverLetter[]>('/api/cover-letters', { job_id }),
  get: (id: string) => api.get<CoverLetter>(`/api/cover-letters/${id}`),
  generate: (job_id: string, use_llm = true) => api.post<CoverLetter>('/api/cover-letters', { job_id, use_llm }),
  update: (id: string, content: string) => api.put<CoverLetter>(`/api/cover-letters/${id}`, { content }),
  remove: (id: string) => api.delete(`/api/cover-letters/${id}`),
  downloadUrl: (id: string, fmt: 'pdf' | 'docx' | 'txt') => `/api/cover-letters/${id}/download/${fmt}`,
}
