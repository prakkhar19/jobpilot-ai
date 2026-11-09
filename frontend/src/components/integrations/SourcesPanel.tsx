import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Globe, Pencil, PlugZap, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Switch,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { errorMessage } from '@/services/api'
import { sourceService } from '@/services/integrations'
import type { JobSource } from '@/types/api'
import { SOURCE_KIND_LABELS } from '@/utils/constants'
import { formatRelative, humanize } from '@/utils/format'
import { DemoSourceButton } from './DemoSourceButton'
import { SourceDialog } from './SourceDialog'

const KEY = ['sources'] as const

function statusTone(s: string) {
  if (!s) return 'neutral' as const
  if (s === 'ok') return 'success' as const
  if (s === 'error' || s === 'failed') return 'danger' as const
  return 'warning' as const
}

function RenameDialog({ source, onClose }: { source: JobSource | null; onClose: () => void }) {
  const [name, setName] = useState(source?.display_name ?? '')
  const rename = useMutationToast({
    mutationFn: (display_name: string) => sourceService.update(source!.id, { display_name }),
    success: 'Source renamed',
    error: 'Could not rename source',
    invalidate: [KEY],
    onSuccess: onClose,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) rename.mutate(name.trim())
  }
  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()} title="Rename source" size="sm">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Display name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={rename.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Job sources list + catalog of unsupported platforms. */
export function SourcesPanel() {
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: KEY, queryFn: sourceService.list })
  const catalog = useQuery({ queryKey: ['sources', 'catalog'], queryFn: sourceService.catalog, staleTime: Infinity })
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<JobSource | null>(null)
  const [deleting, setDeleting] = useState<JobSource | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const toggle = useMutationToast({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => sourceService.update(id, { enabled }),
    success: (_d, v) => (v.enabled ? 'Source enabled' : 'Source disabled'),
    error: 'Could not update source',
    invalidate: [KEY],
  })
  const remove = useMutationToast({
    mutationFn: (id: string) => sourceService.remove(id),
    success: 'Source deleted',
    error: 'Could not delete source',
    invalidate: [KEY],
    onSuccess: () => setDeleting(null),
  })

  const test = async (s: JobSource) => {
    setTesting(s.id)
    try {
      const r = await sourceService.test(s.id)
      const desc = r.job_count != null ? `${r.message} (${r.job_count} open job${r.job_count === 1 ? '' : 's'})` : r.message
      if (r.ok) toast.success(`${s.display_name} is reachable`, { description: desc })
      else toast.error(`${s.display_name} check failed`, { description: desc })
    } catch (err) {
      toast.error('Test failed', { description: errorMessage(err) })
    } finally {
      setTesting(null)
    }
  }

  const refresh = () => void qc.invalidateQueries({ queryKey: KEY })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-subtle">
          JobPilot reads public job boards through their official APIs (Greenhouse, Lever, Ashby) and schema.org job data on
          company career pages.
        </p>
        <div className="flex flex-wrap gap-2">
          <DemoSourceButton sources={data} onCreated={refresh} />
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add source
          </Button>
        </div>
      </div>
      <Card>
        {isPending && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && data.length === 0 && (
          <EmptyState
            icon={<Globe className="h-5 w-5" />}
            title="No job sources yet"
            description="Add a company's Greenhouse, Lever or Ashby board, or a careers page URL."
            action={<Button onClick={() => setAdding(true)}>Add source</Button>}
          />
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-border">
            {data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">{s.display_name || s.identifier}</span>
                    <Badge>{SOURCE_KIND_LABELS[s.kind] ?? humanize(s.kind)}</Badge>
                    {s.last_status && <Badge tone={statusTone(s.last_status)}>{humanize(s.last_status)}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-subtle">
                    {s.identifier} · {s.jobs_found} job{s.jobs_found === 1 ? '' : 's'} found · last checked{' '}
                    {s.last_checked_at ? formatRelative(s.last_checked_at) : 'never'}
                  </p>
                  {s.last_error && <p className="mt-1 text-xs text-danger">{s.last_error}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    label={<span className="sr-only">Enable {s.display_name}</span>}
                    checked={s.enabled}
                    disabled={toggle.isPending}
                    onCheckedChange={(enabled) => toggle.mutate({ id: s.id, enabled })}
                    className="mr-2 items-center"
                  />
                  <Button variant="ghost" size="sm" onClick={() => void test(s)} loading={testing === s.id}>
                    {testing !== s.id && <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />} Test
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setRenaming(s)} aria-label={`Rename ${s.display_name}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(s)} aria-label={`Delete ${s.display_name}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Unsupported platforms"
          description="These sites cannot be searched automatically. Use Discover Jobs → Import job to paste postings from them."
        />
        {catalog.isError && <Alert tone="danger" className="m-4">{errorMessage(catalog.error)}</Alert>}
        {catalog.data && (
          <ul className="divide-y divide-border">
            {catalog.data.unsupported.map((u) => (
              <li key={u.platform} className="flex items-start gap-3 px-5 py-3">
                <Ban className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-fg">{humanize(u.platform)}</p>
                  <p className="text-xs text-subtle">{u.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SourceDialog open={adding} onOpenChange={setAdding} onCreated={refresh} />
      {renaming && <RenameDialog key={renaming.id} source={renaming} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete job source?"
        description={`${deleting?.display_name ?? ''} will no longer be searched. Jobs already discovered are kept.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  )
}
