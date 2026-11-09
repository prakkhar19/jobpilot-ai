import type { Application } from '@/types/api'
import { PRE_SUBMISSION } from '@/utils/constants'

export function canDeleteApplication(app: Pick<Application, 'status'>): boolean {
  return PRE_SUBMISSION.has(app.status) || app.status === 'withdrawn'
}

export function isPreSubmission(status: string): boolean {
  return PRE_SUBMISSION.has(status)
}

/** Whether the detail page should keep polling GET /api/applications/{id}. */
export function needsPolling(app: Pick<Application, 'busy' | 'status'> | undefined): boolean {
  return !!app && (app.busy || app.status === 'submitting')
}

export const APPLICATION_KEY = (id: string) => ['applications', 'detail', id] as const
export const APPLICATION_EVENTS_KEY = (id: string) => ['applications', 'events', id] as const
