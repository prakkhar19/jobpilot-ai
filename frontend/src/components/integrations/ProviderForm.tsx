import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, Button, Checkbox, Field, Input, Select, Switch } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { aiProviderService } from '@/services/integrations'
import type { AIProvider, AIProviderInput, AIProviderKind } from '@/types/api'

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v))

/** Create / edit an AI provider (POST or PUT /api/ai-providers). */
export function ProviderForm({
  provider,
  onSaved,
  onCancel,
  submitLabel,
}: {
  provider?: AIProvider
  onSaved: (p: AIProvider) => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const catalog = useQuery({ queryKey: ['ai-providers', 'catalog'], queryFn: aiProviderService.catalog, staleTime: Infinity })
  const [kind, setKind] = useState<AIProviderKind>((provider?.provider as AIProviderKind) ?? 'openai_compatible')
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '')
  const [model, setModel] = useState(provider?.model ?? '')
  const [embeddingModel, setEmbeddingModel] = useState(provider?.embedding_model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [temperature, setTemperature] = useState(String(provider?.temperature ?? 0.2))
  const [maxTokens, setMaxTokens] = useState(String(provider?.max_tokens ?? 2000))
  const [timeout, setTimeoutS] = useState(String(provider?.timeout_seconds ?? 60))
  const [inPrice, setInPrice] = useState(provider?.input_price_per_mtok?.toString() ?? '')
  const [outPrice, setOutPrice] = useState(provider?.output_price_per_mtok?.toString() ?? '')
  const [isDefault, setIsDefault] = useState(provider?.is_default ?? false)
  const [isFallback, setIsFallback] = useState(provider?.is_fallback ?? false)
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const entry = catalog.data?.[kind]
  const requiresKey = entry?.requires_key ?? kind === 'anthropic'

  const applyPreset = (k: AIProviderKind, ex: { name: string; base_url: string; model: string }) => {
    setKind(k)
    setName(ex.name)
    setBaseUrl(ex.base_url)
    setModel(ex.model)
  }

  const validate = () => {
    const e: Record<string, string | null> = {}
    if (!name.trim()) e.name = 'Name is required.'
    if (!model.trim()) e.model = 'Model is required.'
    const t = Number(temperature)
    if (Number.isNaN(t) || t < 0 || t > 2) e.temperature = 'Between 0 and 2.'
    const m = Number(maxTokens)
    if (!Number.isInteger(m) || m < 256 || m > 64000) e.maxTokens = 'Whole number between 256 and 64000.'
    const to = Number(timeout)
    if (!Number.isInteger(to) || to < 5 || to > 600) e.timeout = 'Whole number between 5 and 600.'
    for (const [k, v] of [['inPrice', inPrice], ['outPrice', outPrice]] as const) {
      if (v.trim() && (Number.isNaN(Number(v)) || Number(v) < 0)) e[k] = 'Must be a positive number.'
    }
    if (requiresKey && !apiKey.trim() && !(provider?.has_api_key && !clearKey)) e.apiKey = 'This provider requires an API key.'
    setErrors(e)
    return !Object.values(e).some(Boolean)
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setFormError(null)
    if (!validate()) return
    const body: AIProviderInput = {
      name: name.trim(),
      provider: kind,
      base_url: baseUrl.trim(),
      model: model.trim(),
      embedding_model: embeddingModel.trim(),
      temperature: Number(temperature),
      max_tokens: Number(maxTokens),
      timeout_seconds: Number(timeout),
      is_default: isDefault,
      is_fallback: isFallback,
      enabled,
      input_price_per_mtok: numOrNull(inPrice),
      output_price_per_mtok: numOrNull(outPrice),
    }
    // Only send the key when the user typed one (or explicitly cleared it) — otherwise the stored key is kept.
    if (apiKey.trim()) body.api_key = apiKey.trim()
    else if (clearKey) body.api_key = ''
    setSaving(true)
    try {
      const saved = provider ? await aiProviderService.update(provider.id, body) : await aiProviderService.create(body)
      toast.success(provider ? 'AI provider updated' : 'AI provider added')
      setApiKey('')
      onSaved(saved)
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {catalog.data && !provider && (
        <div>
          <p className="mb-2 text-sm font-medium text-fg">Quick presets</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(catalog.data).flatMap(([k, c]) =>
              c.examples.map((ex) => (
                <Button key={`${k}-${ex.name}`} variant="outline" size="sm" onClick={() => applyPreset(k as AIProviderKind, ex)}>
                  {ex.name}
                </Button>
              )),
            )}
          </div>
        </div>
      )}
      {catalog.isError && <Alert tone="warning">Could not load the provider catalog: {errorMessage(catalog.error)}</Alert>}
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider type" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value as AIProviderKind)}>
            {catalog.data ? (
              Object.entries(catalog.data).map(([k, c]) => (
                <option key={k} value={k}>
                  {c.label}
                </option>
              ))
            ) : (
              <>
                <option value="openai_compatible">OpenAI-compatible</option>
                <option value="anthropic">Anthropic (Claude)</option>
              </>
            )}
          </Select>
        </Field>
        <Field label="Display name" error={errors.name} required>
          <Input name="provider-name" autoComplete="off" data-1p-ignore value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Base URL" hint={entry ? `Default: ${entry.default_base_url}` : undefined}>
          <Input type="url" name="provider-base-url" autoComplete="off" data-1p-ignore value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={entry?.default_base_url} />
        </Field>
        <Field label="Model" error={errors.model} required>
          <Input name="provider-model" autoComplete="off" data-1p-ignore spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="Embedding model" hint="Optional; enables semantic matching with embeddings.">
          <Input name="provider-embedding-model" autoComplete="off" data-1p-ignore spellCheck={false} value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} />
        </Field>
        <Field
          label="API key"
          error={errors.apiKey}
          required={requiresKey && !provider?.has_api_key}
          hint={
            provider?.has_api_key
              ? `A key ending in …${provider.api_key_last4 || '****'} is stored (encrypted). Leave blank to keep it.`
              : requiresKey
                ? 'Stored encrypted on this server.'
                : 'Optional for local servers such as Ollama. Stored encrypted.'
          }
        >
          <Input type="password" name="provider-api-key" autoComplete="new-password" data-1p-ignore value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
      </div>
      {provider?.has_api_key && (
        <Checkbox label="Remove the stored API key" checked={clearKey} onCheckedChange={setClearKey} disabled={!!apiKey} />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Temperature" error={errors.temperature}>
          <Input type="number" step="0.1" min={0} max={2} value={temperature} onChange={(e) => setTemperature(e.target.value)} />
        </Field>
        <Field label="Max tokens" error={errors.maxTokens}>
          <Input type="number" min={256} max={64000} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
        </Field>
        <Field label="Timeout (seconds)" error={errors.timeout}>
          <Input type="number" min={5} max={600} value={timeout} onChange={(e) => setTimeoutS(e.target.value)} />
        </Field>
        <Field label="Input price / 1M tokens (USD)" error={errors.inPrice} hint="Optional, for cost estimates.">
          <Input type="number" step="0.01" min={0} value={inPrice} onChange={(e) => setInPrice(e.target.value)} />
        </Field>
        <Field label="Output price / 1M tokens (USD)" error={errors.outPrice}>
          <Input type="number" step="0.01" min={0} value={outPrice} onChange={(e) => setOutPrice(e.target.value)} />
        </Field>
      </div>
      <div className="space-y-3 rounded-lg border border-border p-4">
        <Switch label="Enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Switch label="Default provider" description="Used for all AI features." checked={isDefault} onCheckedChange={setIsDefault} />
        <Switch label="Fallback provider" description="Used when the default provider fails." checked={isFallback} onCheckedChange={setIsFallback} />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={saving}>
          {submitLabel ?? (provider ? 'Save changes' : 'Add provider')}
        </Button>
      </div>
    </form>
  )
}
