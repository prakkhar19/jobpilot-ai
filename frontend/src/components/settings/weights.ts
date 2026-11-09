export const WEIGHT_LABELS: Record<string, string> = {
  required_skills: 'Required skills',
  preferred_skills: 'Preferred skills',
  semantic_similarity: 'Overall content similarity',
  experience: 'Experience level',
  role_alignment: 'Role / title alignment',
  education: 'Education',
  location: 'Location & work style',
}

/** Normalises raw weights so they sum to 100 %, mirroring backend services/matching.normalize_weights. */
export function normalizedPercents(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(weights)) out[k] = total > 0 ? (Math.max(0, v) / total) * 100 : 0
  return out
}

/** Initial slider values: user-provided raw weights where present, otherwise the effective (normalised) defaults. */
export function initialWeights(raw: Record<string, number>, effective: Record<string, number>): Record<string, number> {
  const keys = Object.keys(effective)
  const out: Record<string, number> = {}
  const hasRaw = keys.some((k) => typeof raw[k] === 'number')
  for (const k of keys) {
    out[k] = hasRaw && typeof raw[k] === 'number' ? raw[k] : Math.round(effective[k] * 100) / 100
  }
  return out
}
