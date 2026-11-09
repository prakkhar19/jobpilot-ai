import type { AnalyticsSummary } from '@/types/api'

export function summaryFixture(overrides: Partial<AnalyticsSummary['totals']> = {}): AnalyticsSummary {
  return {
    totals: {
      jobs_discovered: 128,
      active_jobs: 120,
      qualified: 17,
      shortlisted: 9,
      prepared: 6,
      pending_approval: 3,
      submitted: 11,
      interviews: 4,
      rejections: 2,
      offers: 1,
      response_rate: 36.4,
      interview_rate: 27.3,
      threshold: 60,
      ...overrides,
    },
    funnel: [
      { stage: 'Discovered', count: 128 },
      { stage: 'Qualified', count: 17 },
      { stage: 'Prepared', count: 6 },
      { stage: 'Submitted', count: 11 },
      { stage: 'Interviews', count: 4 },
      { stage: 'Offers', count: 1 },
    ],
    weekly: [{ week: '2026-11-02', discovered: 40, submitted: 3, interviews: 1 }],
    status_counts: { submitted: 7, interview_scheduled: 3 },
    by_source: [
      { key: 'greenhouse', applications: 8, submitted: 6, responses: 3, interviews: 2, offers: 1, response_rate: 50, interview_rate: 33.3 },
    ],
    by_role: [],
    by_company: [],
    by_resume: [],
    insights: ["'Backend' roles have your best response rate (50%)."],
    disclaimer: 'Match scores and statistics are guidance only; no score guarantees an interview or offer.',
  }
}
