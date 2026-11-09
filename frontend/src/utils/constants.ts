import type { Recommendation, TaskState } from '@/types/api'

export const ACTIVE_TASK_STATES: ReadonlySet<string> = new Set<TaskState>([
  'IDLE',
  'DISCOVERING',
  'ANALYZING',
  'MATCHING',
  'GENERATING_RESUME',
  'PREPARING_APPLICATION',
  'SUBMITTING',
  'VERIFYING',
])

export function isTaskActive(state: string | undefined | null): boolean {
  return !!state && ACTIVE_TASK_STATES.has(state)
}

export const TASK_STATE_LABELS: Record<string, string> = {
  IDLE: 'Queued',
  DISCOVERING: 'Discovering jobs',
  ANALYZING: 'Analyzing postings',
  MATCHING: 'Matching to your profile',
  GENERATING_RESUME: 'Generating documents',
  PREPARING_APPLICATION: 'Preparing applications',
  SUBMITTING: 'Submitting',
  VERIFYING: 'Verifying',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  PAUSED: 'Paused',
  CANCELLED: 'Cancelled',
  AWAITING_APPROVAL: 'Awaiting approval',
}

/** Mirrors backend services/applications.py STATUS_LABELS (the live list comes from /api/applications/statuses). */
export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  shortlisted: 'Shortlisted',
  rejected_by_filter: 'Rejected by filter',
  resume_generated: 'Resume generated',
  needs_input: 'Needs your input',
  awaiting_approval: 'Awaiting approval',
  ready_to_submit: 'Ready to submit',
  submitting: 'Submitting',
  submitted: 'Submitted',
  under_review: 'Under review',
  assessment: 'Assessment',
  interview_scheduled: 'Interview scheduled',
  interview_completed: 'Interview completed',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  offer_received: 'Offer received',
}

export const PRE_SUBMISSION = new Set([
  'discovered',
  'shortlisted',
  'rejected_by_filter',
  'resume_generated',
  'needs_input',
  'awaiting_approval',
  'ready_to_submit',
])

export const POST_SUBMISSION = new Set([
  'submitted',
  'under_review',
  'assessment',
  'interview_scheduled',
  'interview_completed',
  'rejected',
  'offer_received',
  'withdrawn',
])

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export function statusTone(status: string): Tone {
  switch (status) {
    case 'needs_input':
    case 'awaiting_approval':
      return 'warning'
    case 'ready_to_submit':
    case 'submitting':
      return 'primary'
    case 'submitted':
    case 'under_review':
    case 'assessment':
      return 'info'
    case 'interview_scheduled':
    case 'interview_completed':
    case 'offer_received':
      return 'success'
    case 'rejected':
    case 'rejected_by_filter':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function taskTone(state: string): Tone {
  if (state === 'COMPLETED') return 'success'
  if (state === 'FAILED') return 'danger'
  if (state === 'CANCELLED' || state === 'PAUSED') return 'neutral'
  if (state === 'AWAITING_APPROVAL') return 'warning'
  return 'primary'
}

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strong_match: 'Strong match',
  good_match: 'Good match',
  consider: 'Partial match',
  weak_match: 'Weak match',
}

export const RECOMMENDATION_TEXT: Record<Recommendation, string> = {
  strong_match: 'Strong match — worth applying.',
  good_match: 'Good match — consider applying.',
  consider: 'Partial match — review the gaps before applying.',
  weak_match: 'Weak match — probably not worth applying.',
}

export function recommendationTone(rec: string | null | undefined): Tone {
  switch (rec) {
    case 'strong_match':
      return 'success'
    case 'good_match':
      return 'primary'
    case 'consider':
      return 'warning'
    case 'weak_match':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return 'neutral'
  if (score >= 75) return 'success'
  if (score >= 60) return 'primary'
  if (score >= 45) return 'warning'
  return 'danger'
}

export const SOURCE_KIND_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  career_page: 'Career page',
  demo: 'Demo sandbox',
  manual: 'Manual import',
}

export const WORKPLACE_LABELS: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Unspecified',
}

export const ANSWER_SOURCE_LABELS: Record<string, string> = {
  profile: 'Profile',
  facts: 'Application facts',
  answer_bank: 'Answer bank',
  user: 'You',
  document: 'Document',
}

export const INTERVIEW_KIND_LABELS: Record<string, string> = {
  phone_screen: 'Phone screen',
  technical: 'Technical',
  system_design: 'System design',
  behavioral: 'Behavioral',
  onsite: 'On-site',
  hr: 'HR',
  final: 'Final round',
  other: 'Other',
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
