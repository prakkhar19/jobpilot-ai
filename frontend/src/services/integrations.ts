import type {
  AIProvider,
  AIProviderCatalog,
  AIProviderInput,
  AITestResult,
  JobSource,
  ScreeningAnswer,
  SourceCatalog,
  SourceInput,
  SourceTestResult,
} from '@/types/api'
import { api } from './api'

export const aiProviderService = {
  catalog: () => api.get<AIProviderCatalog>('/api/ai-providers/catalog'),
  list: () => api.get<AIProvider[]>('/api/ai-providers'),
  create: (body: AIProviderInput) => api.post<AIProvider>('/api/ai-providers', body),
  update: (id: string, body: AIProviderInput) => api.put<AIProvider>(`/api/ai-providers/${id}`, body),
  remove: (id: string) => api.delete(`/api/ai-providers/${id}`),
  test: (id: string) => api.post<AITestResult>(`/api/ai-providers/${id}/test`),
}

export const sourceService = {
  catalog: () => api.get<SourceCatalog>('/api/sources/catalog'),
  list: () => api.get<JobSource[]>('/api/sources'),
  create: (body: SourceInput) => api.post<JobSource>('/api/sources', body),
  update: (id: string, body: { display_name?: string | null; enabled?: boolean | null }) =>
    api.patch<JobSource>(`/api/sources/${id}`, body),
  remove: (id: string) => api.delete(`/api/sources/${id}`),
  test: (id: string) => api.post<SourceTestResult>(`/api/sources/${id}/test`),
}

export const answerBankService = {
  list: () => api.get<ScreeningAnswer[]>('/api/screening-answers'),
  upsert: (question_text: string, answer: string) =>
    api.post<ScreeningAnswer>('/api/screening-answers', { question_text, answer }),
  remove: (id: string) => api.delete(`/api/screening-answers/${id}`),
}
