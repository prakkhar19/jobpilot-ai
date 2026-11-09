import { PlugZap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { aiProviderService } from '@/services/integrations'
import type { AITestResult } from '@/types/api'

/** POST /api/ai-providers/{id}/test and show the outcome inline. */
export function ProviderTestButton({ providerId, onTested }: { providerId: string; onTested?: (r: AITestResult) => void }) {
  const [result, setResult] = useState<AITestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const test = async () => {
    setTesting(true)
    try {
      const r = await aiProviderService.test(providerId)
      setResult(r)
      if (r.ok) toast.success('Connection works', { description: r.message })
      else toast.error('Connection failed', { description: r.message })
      onTested?.(r)
    } catch (err) {
      toast.error('Test failed', { description: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={test} loading={testing}>
        {!testing && <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />} Test connection
      </Button>
      {result && (
        <span className="flex flex-wrap items-center gap-2 text-xs" role="status">
          <Badge tone={result.ok ? 'success' : 'danger'}>{result.ok ? 'Connected' : 'Failed'}</Badge>
          <span className="text-muted">{result.message}</span>
          {result.latency_ms != null && <span className="text-subtle">{result.latency_ms} ms</span>}
        </span>
      )}
    </div>
  )
}
