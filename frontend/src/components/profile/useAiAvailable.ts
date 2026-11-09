import { useQuery } from '@tanstack/react-query'
import { aiProviderService } from '@/services/integrations'

/** True when at least one enabled AI provider is configured. */
export function useAiAvailable(): { available: boolean; loading: boolean } {
  const { data, isPending } = useQuery({ queryKey: ['ai-providers'], queryFn: aiProviderService.list })
  return { available: !!data?.some((p) => p.enabled), loading: isPending }
}
