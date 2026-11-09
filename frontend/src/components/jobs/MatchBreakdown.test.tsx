import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Match } from '@/types/api'
import { MatchBreakdown } from './MatchBreakdown'

const match: Match = {
  overall_score: 72.4,
  recommendation: 'good_match',
  components: [
    { key: 'required_skills', label: 'Required skills', score: 66.7, weight: 0.35, status: 'scored', detail: '2 of 3 found in your profile.', matched: ['Python', 'SQL'], missing: ['Kubernetes'] },
    { key: 'education', label: 'Education', score: null, weight: 0.05, status: 'unknown', detail: 'Your profile has no education entries.', matched: [], missing: [] },
    { key: 'preferred_skills', label: 'Preferred skills', score: null, weight: 0.1, status: 'not_applicable', detail: 'The posting does not list these.', matched: [], missing: [] },
    { key: '_confidence', value: 0.83 },
  ],
  strengths: ['Strong Python background'],
  gaps: ['Kubernetes not in profile'],
  unknowns: ['Education: no entries'],
  weights: {},
  llm_summary: '',
  similarity_method: 'tfidf',
  computed_at: '2026-01-01T00:00:00Z',
  profile_version: 1,
}

describe('MatchBreakdown', () => {
  it('renders scored components with a score bar, weight and matched/missing chips', () => {
    render(<MatchBreakdown match={match} />)
    const row = screen.getByTestId('component-required_skills')
    expect(within(row).getByText('Scored')).toBeInTheDocument()
    expect(within(row).getByText('Weight 35%')).toBeInTheDocument()
    expect(within(row).getByText('67/100')).toBeInTheDocument()
    expect(within(row).getByRole('meter', { name: 'Required skills score' })).toHaveAttribute('aria-valuenow', '66.7')
    expect(within(row).getByText('Python')).toBeInTheDocument()
    expect(within(row).getByText('Kubernetes')).toBeInTheDocument()
  })

  it('renders unknown and not-applicable components without a score bar', () => {
    render(<MatchBreakdown match={match} />)
    const unknown = screen.getByTestId('component-education')
    expect(within(unknown).getByText('Unknown')).toBeInTheDocument()
    expect(within(unknown).queryByRole('meter')).not.toBeInTheDocument()
    expect(within(unknown).getByText('—')).toBeInTheDocument()
    expect(within(unknown).getByText('Your profile has no education entries.')).toBeInTheDocument()
    const na = screen.getByTestId('component-preferred_skills')
    expect(within(na).getByText('Not applicable')).toBeInTheDocument()
    expect(within(na).queryByRole('meter')).not.toBeInTheDocument()
  })

  it('hides the _confidence pseudo-entry and shows confidence separately', () => {
    render(<MatchBreakdown match={match} />)
    expect(screen.queryByTestId('component-_confidence')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Match components' })).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Confidence 83%')).toBeInTheDocument()
    expect(screen.getByText('Good match')).toBeInTheDocument()
    expect(screen.getByText('Strong Python background')).toBeInTheDocument()
    expect(screen.getByText('Kubernetes not in profile')).toBeInTheDocument()
  })
})
