import type { ApplyQueueItem } from '@/types/api'

/** A short note (under LinkedIn's 300-character limit) asking someone at the company for a referral. */
export function referralMessage(firstName: string, item: Pick<ApplyQueueItem, 'title' | 'company'>): string {
  const me = firstName ? `I'm ${firstName}. ` : ''
  return (
    `Hi, ${me}I'm applying for the ${item.title} role at ${item.company} and believe my experience fits it well. ` +
    `Would you be open to referring me? Happy to share my resume. Thank you!`
  ).slice(0, 300)
}

export function peopleSearchUrl(company: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company)}`
}
