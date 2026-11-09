import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, Button, Dialog, Field, Input, Select, Switch } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { sourceService } from '@/services/integrations'
import type { JobSource, SourceKind } from '@/types/api'

/** Add a job source (POST /api/sources); options come from GET /api/sources/catalog. */
export function SourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (s: JobSource) => void
}) {
  const catalog = useQuery({ queryKey: ['sources', 'catalog'], queryFn: sourceService.catalog, staleTime: Infinity })
  const supported = catalog.data?.supported.filter((s) => s.kind !== 'demo') ?? []
  const [kind, setKind] = useState<SourceKind | ''>('')
  const [identifier, setIdentifier] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const effectiveKind = (kind || supported[0]?.kind || '') as SourceKind | ''
  const entry = supported.find((s) => s.kind === effectiveKind)

  const reset = () => {
    setKind('')
    setIdentifier('')
    setDisplayName('')
    setEnabled(true)
    setError(null)
    setFieldError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!identifier.trim()) {
      setFieldError('Identifier is required.')
      return
    }
    if (!effectiveKind) return
    setFieldError(null)
    setSaving(true)
    try {
      const s = await sourceService.create({
        kind: effectiveKind,
        identifier: identifier.trim(),
        display_name: displayName.trim(),
        enabled,
      })
      toast.success('Job source added', { description: s.display_name })
      reset()
      onCreated(s)
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      title="Add job source"
      description="JobPilot checks the board is reachable before saving it."
    >
      {catalog.isPending && <p className="text-sm text-subtle">Loading source types…</p>}
      {catalog.isError && <Alert tone="danger">{errorMessage(catalog.error)}</Alert>}
      {catalog.data && (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Source type" required hint={entry?.description}>
            <Select value={effectiveKind} onChange={(e) => setKind(e.target.value as SourceKind)}>
              {supported.map((s) => (
                <option key={s.kind} value={s.kind}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Identifier" required error={fieldError} hint={entry?.identifier_help}>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </Field>
          <Field label="Display name" hint="Optional; detected automatically when possible.">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Switch label="Enabled" description="Include this source in discovery runs." checked={enabled} onCheckedChange={setEnabled} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Add source
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
