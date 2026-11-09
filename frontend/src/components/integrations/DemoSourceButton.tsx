import { FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { errorMessage } from '@/services/api'
import { sourceService } from '@/services/integrations'
import type { JobSource } from '@/types/api'

/** One-click demo sandbox board (only rendered when the server runs in demo mode). */
export function DemoSourceButton({ sources, onCreated }: { sources: JobSource[] | undefined; onCreated: (s: JobSource) => void }) {
  const { status } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!status?.demo_mode) return null
  const exists = sources?.some((s) => s.kind === 'demo')
  const add = async () => {
    setBusy(true)
    try {
      const s = await sourceService.create({ kind: 'demo', identifier: 'sandbox', display_name: 'Demo sandbox', enabled: true })
      toast.success('Demo sandbox added', { description: 'Fictional jobs with a sandbox application portal.' })
      onCreated(s)
    } catch (err) {
      toast.error('Could not add the demo sandbox', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" onClick={add} loading={busy} disabled={exists} title={exists ? 'Already added' : undefined}>
      {!busy && <FlaskConical className="h-4 w-4" aria-hidden="true" />}
      {exists ? 'Demo sandbox added' : 'Add demo sandbox'}
    </Button>
  )
}
