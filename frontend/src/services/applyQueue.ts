import type { ApplyQueue, ApplyQueueItem, FormAnswer } from '@/types/api'
import { api } from './api'

export const applyQueueService = {
  list: (limit = 50) => api.get<ApplyQueue>('/api/apply-queue', { limit }),
  prepare: (jobId: string) => api.post<ApplyQueueItem>(`/api/apply-queue/${jobId}/prepare`),
  applied: (jobId: string) => api.post<void>(`/api/apply-queue/${jobId}/applied`),
  answers: (jobId: string, questions: string) =>
    api.post<FormAnswer[]>(`/api/apply-queue/${jobId}/answers`, { questions }),
}
