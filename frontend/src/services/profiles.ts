import type { MasterResume, Profile, ProfileData, ProfileSummary, UploadResult } from '@/types/api'
import { api } from './api'

export const profileService = {
  list: () => api.get<ProfileSummary[]>('/api/profiles'),
  active: () => api.get<Profile | null>('/api/profiles/active'),
  get: (id: string) => api.get<Profile>(`/api/profiles/${id}`),
  create: () => api.post<Profile>('/api/profiles'),
  update: (id: string, data: ProfileData) => api.put<Profile>(`/api/profiles/${id}`, data),
  remove: (id: string) => api.delete(`/api/profiles/${id}`),
  approve: (id: string) => api.post<Profile>(`/api/profiles/${id}/approve`),
  activate: (id: string) => api.post<Profile>(`/api/profiles/${id}/activate`),
  duplicate: (id: string) => api.post<Profile>(`/api/profiles/${id}/duplicate`),
}

export const resumeFileService = {
  list: () => api.get<MasterResume[]>('/api/resumes'),
  upload: (file: File, useLlm: boolean, label = '') => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('use_llm', useLlm ? 'true' : 'false')
    fd.append('label', label)
    return api.post<UploadResult>('/api/resumes', fd)
  },
  text: (id: string) => api.get<{ text: string }>(`/api/resumes/${id}/text`),
  remove: (id: string) => api.delete(`/api/resumes/${id}`),
  downloadUrl: (id: string) => `/api/resumes/${id}/download`,
}
