import type { AIProvider, AIProviderInput, AIProviderKind } from '@/types/api'

/** Rebuilds a full PUT body from a stored provider (the API key is omitted so the stored one is kept). */
export function providerToInput(p: AIProvider, overrides: Partial<AIProviderInput> = {}): AIProviderInput {
  return {
    name: p.name,
    provider: p.provider as AIProviderKind,
    base_url: p.base_url,
    model: p.model,
    embedding_model: p.embedding_model,
    temperature: p.temperature,
    max_tokens: p.max_tokens,
    timeout_seconds: p.timeout_seconds,
    is_default: p.is_default,
    is_fallback: p.is_fallback,
    enabled: p.enabled,
    input_price_per_mtok: p.input_price_per_mtok,
    output_price_per_mtok: p.output_price_per_mtok,
    ...overrides,
  }
}
