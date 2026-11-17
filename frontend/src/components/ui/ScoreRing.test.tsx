import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScoreRing } from './ScoreRing'

describe('ScoreRing', () => {
  it('shows the rounded score with an accessible label', () => {
    render(<ScoreRing score={72.6} />)
    expect(screen.getByTitle('Match score 73 of 100')).toHaveTextContent('73 match score')
  })
  it('shows a dash when the job is not matched yet', () => {
    render(<ScoreRing score={null} />)
    expect(screen.getByTitle('Not matched yet')).toHaveTextContent('—')
  })
})
