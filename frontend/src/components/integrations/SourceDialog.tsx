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
  const [credentials, setCredentials] = useState<Record<string, string>>({})
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
    setCredentials({})
    setError(null)
    setFieldError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!identifier.trim() && !entry?.identifier_default) {
      setFieldError('Identifier is required.')
      return
    }
    if (!effectiveKind) return
    const missing = (entry?.credential_fields ?? []).filter((f) => !credentials[f.key]?.trim())
    if (missing.length) {
      setError(`Please fill in: ${missing.map((f) => f.label).join(', ')}`)
      return
    }
    setFieldError(null)
    setSaving(true)
    try {
      const s = await sourceService.create({
        kind: effectiveKind,
        identifier: identifier.trim(),
        display_name: displayName.trim(),
        enabled,
        ...(entry?.credential_fields?.length ? { credentials } : {}),
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
          <Field
            label="Identifier"
            required={!entry?.identifier_default}
            error={fieldError}
            hint={entry?.identifier_default ? `${entry.identifier_help} (default: ${entry.identifier_default})` : entry?.identifier_help}
          >
            <Input
              value={identifier}
              placeholder={entry?.identifier_default ?? ''}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </Field>
          {(entry?.credential_fields ?? []).map((f) => (
            <Field key={f.key} label={f.label} required hint={f.secret ? 'Stored encrypted; never shown again.' : undefined}>
              <Input
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                value={credentials[f.key] ?? ''}
                onChange={(e) => setCredentials((c) => ({ ...c, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
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
