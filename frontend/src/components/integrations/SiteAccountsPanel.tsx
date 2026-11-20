import { useQuery } from '@tanstack/react-query'
import { Copy, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { siteAccountService } from '@/services/integrations'
import { formatRelative } from '@/utils/format'

/** Accounts the Chrome extension created on employer careers portals (Workday etc.) while applying. */
export function SiteAccountsPanel() {
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['site-accounts'], queryFn: siteAccountService.list })
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const copy = (v: string) => {
    void navigator.clipboard.writeText(v).then(() => toast.success('Copied'))
  }
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-subtle">
        When a company&apos;s careers site needs an account, the extension creates one with your email and a strong password,
        verifies it through your connected mailbox, and saves it here — use it to sign in and check your application.
      </p>
      <Card>
        {isPending && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && data.length === 0 && (
          <EmptyState
            icon={<KeyRound className="h-5 w-5" />}
            title="No careers-site accounts yet"
            description="They appear here when the extension signs up on a company's careers portal."
          />
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-border">
            {data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <a href={`https://${a.host}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-fg underline">
                    {a.host}
                  </a>
                  <p className="mt-0.5 text-sm text-muted">
                    {a.email} · <span className="font-mono">{shown[a.id] ? a.password : '••••••••••••'}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {a.verified ? 'Verified' : 'Not verified yet'} · created {formatRelative(a.created_at)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setShown((s) => ({ ...s, [a.id]: !s[a.id] }))}
                    aria-label={shown[a.id] ? `Hide password for ${a.host}` : `Show password for ${a.host}`}>
                    {shown[a.id] ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => copy(a.password)} aria-label={`Copy password for ${a.host}`}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
