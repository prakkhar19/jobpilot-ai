import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, MoreHorizontal, Pencil, Plus, Star, Trash2, LifeBuoy } from 'lucide-react'
import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DefinitionList,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { aiProviderService } from '@/services/integrations'
import type { AIProvider } from '@/types/api'
import { formatNumber, formatRelative } from '@/utils/format'
import { providerToInput } from './providerInput'
import { ProviderForm } from './ProviderForm'
import { ProviderTestButton } from './ProviderTestButton'

const KEY = ['ai-providers'] as const

export function ProvidersPanel() {
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: KEY, queryFn: aiProviderService.list })
  const [editing, setEditing] = useState<AIProvider | 'new' | null>(null)
  const [deleting, setDeleting] = useState<AIProvider | null>(null)

  const setRole = useMutationToast({
    mutationFn: ({ p, role }: { p: AIProvider; role: 'default' | 'fallback' }) =>
      aiProviderService.update(p.id, providerToInput(p, role === 'default' ? { is_default: true } : { is_fallback: true })),
    success: (_d, v) => `${v.p.name} is now the ${v.role} provider`,
    error: 'Could not update provider',
    invalidate: [KEY],
  })
  const remove = useMutationToast({
    mutationFn: (id: string) => aiProviderService.remove(id),
    success: 'AI provider deleted',
    error: 'Could not delete provider',
    invalidate: [KEY],
    onSuccess: () => setDeleting(null),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-subtle">
          AI is optional. Without a provider JobPilot uses deterministic, rule-based parsing, matching and templates. Keys are
          encrypted at rest and never sent to the browser.
        </p>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add provider
        </Button>
      </div>
      {isPending && <LoadingState />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <Card>
          <EmptyState
            icon={<Bot className="h-5 w-5" />}
            title="No AI providers configured"
            description="Connect OpenAI, NVIDIA NIM (Nemotron), a local Ollama server or Anthropic Claude."
            action={<Button onClick={() => setEditing('new')}>Add provider</Button>}
          />
        </Card>
      )}
      {data?.map((p) => (
        <Card key={p.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-fg">{p.name}</h3>
                {p.is_default && <Badge tone="primary">Default</Badge>}
                {p.is_fallback && <Badge tone="info">Fallback</Badge>}
                {!p.enabled && <Badge>Disabled</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-subtle">
                {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} · {p.model}
                {p.base_url ? ` · ${p.base_url}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-subtle">
                API key: {p.has_api_key ? `stored (…${p.api_key_last4 || '****'})` : 'none'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ProviderTestButton providerId={p.id} onTested={() => void qc.invalidateQueries({ queryKey: KEY })} />
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${p.name}`}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => setEditing(p)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                  </MenuItem>
                  <MenuItem disabled={p.is_default} onSelect={() => setRole.mutate({ p, role: 'default' })}>
                    <Star className="h-4 w-4" aria-hidden="true" /> Set as default
                  </MenuItem>
                  <MenuItem disabled={p.is_fallback} onSelect={() => setRole.mutate({ p, role: 'fallback' })}>
                    <LifeBuoy className="h-4 w-4" aria-hidden="true" /> Set as fallback
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onSelect={() => setDeleting(p)} className="text-danger">
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </div>
          <DefinitionList
            className="mt-4 sm:grid-cols-3 lg:grid-cols-6"
            items={[
              ['Requests', formatNumber(p.total_requests)],
              ['Input tokens', formatNumber(p.total_input_tokens)],
              ['Output tokens', formatNumber(p.total_output_tokens)],
              ['Errors', formatNumber(p.total_errors)],
              [
                'Estimated cost',
                p.estimated_cost_usd == null ? <span className="text-subtle">Set prices to estimate</span> : `$${p.estimated_cost_usd.toFixed(4)}`,
              ],
              ['Last used', p.last_used_at ? formatRelative(p.last_used_at) : 'Never'],
            ]}
          />
          {p.last_error && (
            <Alert tone="danger" title="Last error" className="mt-4">
              {p.last_error}
            </Alert>
          )}
        </Card>
      ))}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Add AI provider' : 'Edit AI provider'}
        size="lg"
      >
        {editing !== null && (
          <ProviderForm
            provider={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              void qc.invalidateQueries({ queryKey: KEY })
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete AI provider?"
        description={`${deleting?.name ?? ''} and its stored API key will be removed.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  )
}
