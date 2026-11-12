import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { AuthorizedModeDialog } from '@/components/settings/AuthorizedModeDialog'
import { WeightSliders } from '@/components/settings/WeightSliders'
import { initialWeights } from '@/components/settings/weights'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TagInput,
} from '@/components/ui'
import { agentService, toConfigInput } from '@/services/agent'
import { errorMessage } from '@/services/api'
import { resumeService } from '@/services/documents'
import type { AgentConfig, AgentConfigInput, ApplicationMode, ExperienceLevel, WorkplacePref } from '@/types/api'
import { cn } from '@/utils/cn'
import { WEEKDAYS } from '@/utils/constants'
import { formatDate } from '@/utils/format'

const CONFIG_KEY = ['agent', 'config'] as const

const MODES: { value: ApplicationMode; label: string; description: string }[] = [
  {
    value: 'review',
    label: 'Review',
    description:
      'The agent prepares documents and fills in answers, then waits. You approve and submit every application yourself.',
  },
  {
    value: 'assisted',
    label: 'Assisted',
    description:
      'Like Review, plus the agent can open supported application forms and pre-fill them so you can check a screenshot before submitting.',
  },
  {
    value: 'authorized',
    label: 'Authorized automation',
    description:
      'The agent may submit applications on supported sites without asking — only when every answer is verified and the match score meets your threshold.',
  },
]

const WORKPLACES: WorkplacePref[] = ['remote', 'hybrid', 'onsite']
const LEVELS: ExperienceLevel[] = ['intern', 'junior', 'mid', 'senior', 'lead', 'staff', 'principal']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function timezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    return fn ? fn('timeZone') : []
  } catch {
    return []
  }
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

export default function SettingsPage() {
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: CONFIG_KEY, queryFn: agentService.config })
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Control how and when the agent searches, what it looks for, how jobs are scored, and how applications are handled."
      />
      <Tabs defaultValue="agent">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="agent">Agent & search</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="agent">
          {isPending && <LoadingState label="Loading agent configuration…" />}
          {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
          {data && <AgentSettingsForm config={data} />}
        </TabsContent>
        <TabsContent value="account">
          <AccountSettings />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AgentSettingsForm({ config }: { config: AgentConfig }) {
  const qc = useQueryClient()
  const ids = useId()
  const [form, setForm] = useState<AgentConfigInput>(() => toConfigInput(config))
  const defaults = useMemo(() => initialWeights({}, config.effective_weights), [config.effective_weights])
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    initialWeights(config.matching_weights ?? {}, config.effective_weights),
  )
  const [authDialog, setAuthDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const tzList = useMemo(() => timezones(), [])
  const templates = useQuery({ queryKey: ['resume-templates'], queryFn: resumeService.templates })

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const set = <K extends keyof AgentConfigInput>(key: K, value: AgentConfigInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const chooseMode = (mode: ApplicationMode) => {
    if (mode === 'authorized' && form.application_mode !== 'authorized' && !config.authorized_automation_ack_at) {
      setAuthDialog(true)
      return
    }
    setForm((f) => ({ ...f, application_mode: mode, acknowledge_authorized_automation: mode === 'authorized' ? f.acknowledge_authorized_automation : false }))
    setDirty(true)
  }

  const allZero = Object.values(weights).every((w) => w <= 0)
  const windowInvalid = form.window_start_hour === form.window_end_hour

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (allZero) {
      toast.error('At least one matching weight must be above zero.')
      return
    }
    setSaving(true)
    try {
      const body: AgentConfigInput = { ...form, matching_weights: weights }
      const updated = await agentService.saveConfig(body)
      qc.setQueryData(CONFIG_KEY, updated)
      setForm(toConfigInput(updated))
      setDirty(false)
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Settings saved', {
        description: 'Changes to weights or the threshold apply to new matches; use “Re-match all” on Discover Jobs to rescore existing jobs.',
      })
    } catch (err) {
      toast.error('Could not save settings', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const tagField = (key: keyof AgentConfigInput, label: string, hint?: string) => (
    <TagInput
      label={label}
      hint={hint}
      value={form[key] as string[]}
      onChange={(v) => set(key, v as never)}
    />
  )

  return (
    <form onSubmit={save} className="space-y-6" aria-describedby={`${ids}-status`}>
      <Card>
        <CardHeader
          title="Agent & schedule"
          description="When enabled, the agent runs discovery → matching → document preparation on this schedule."
          actions={
            config.paused ? <Badge tone="warning">Paused</Badge> : form.enabled ? <Badge tone="success">Scheduled</Badge> : <Badge>Manual only</Badge>
          }
        />
        <CardBody className="space-y-5">
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => set('enabled', v)}
            label="Run the agent automatically"
            description={`Last run: ${formatDate(config.last_run_at, true)} · Next run: ${config.next_run_at ? formatDate(config.next_run_at, true) : 'not scheduled'}`}
          />
          <Switch
            checked={form.alert_on_new_matches}
            onCheckedChange={(v) => set('alert_on_new_matches', v)}
            label="Alert me instantly about strong new matches"
            description="In-app notification as soon as a new job above your minimum score is found — apply early."
          />
          <Switch
            checked={form.email_alerts}
            onCheckedChange={(v) => set('email_alerts', v)}
            label="Also email me new matches"
            description="Requires SMTP to be configured on this server."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Search every (minutes)" hint="Minimum 15. Sources with usage limits are checked less often automatically.">
              <Input
                type="number"
                min={15}
                max={10080}
                value={form.frequency_minutes}
                onChange={(e) => set('frequency_minutes', Math.max(15, Math.min(10080, Number(e.target.value) || 15)))}
              />
            </Field>
            <Field label="Window start">
              <Select value={form.window_start_hour} onChange={(e) => set('window_start_hour', Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Window end" error={windowInvalid ? 'Start and end hour are the same.' : null}>
              <Select value={form.window_end_hour} onChange={(e) => set('window_end_hour', Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Timezone" hint="IANA name, e.g. Europe/Berlin.">
              <Input
                value={form.timezone}
                onChange={(e) => set('timezone', e.target.value)}
                list={`${ids}-tz`}
                maxLength={60}
              />
            </Field>
            <datalist id={`${ids}-tz`}>
              {tzList.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-fg">Run on</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAYS.map((d, i) => {
                const on = form.run_days.includes(i)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('run_days', toggle(form.run_days, i).sort((a, b) => a - b))}
                    className={cn(
                      'h-8 w-12 rounded-lg border text-sm font-medium',
                      on ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong text-muted hover:bg-surface-2',
                    )}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
            {form.run_days.length === 0 && <p className="mt-1 text-xs text-subtle">No days selected — the agent may run on any day.</p>}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Search filters" description="What the agent looks for when discovering jobs. Leave a list empty to not filter on it." />
        <CardBody className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            {tagField('target_roles', 'Target roles', 'e.g. Machine Learning Engineer')}
            {tagField('keywords', 'Keywords', 'Postings mentioning these rank higher.')}
            {tagField('excluded_keywords', 'Excluded keywords', 'Postings containing these are skipped.')}
            {tagField('required_technologies', 'Required technologies')}
            {tagField('locations', 'Locations', 'Cities or regions.')}
            {tagField('countries', 'Countries')}
            {tagField('employment_types', 'Employment types', 'e.g. full-time, contract')}
            {tagField('industries', 'Industries')}
            {tagField('include_companies', 'Only these companies', 'Leave empty to allow all companies.')}
            {tagField('exclude_companies', 'Exclude companies')}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <fieldset>
              <legend className="text-sm font-medium text-fg">Workplace types</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {WORKPLACES.map((w) => (
                  <Checkbox
                    key={w}
                    label={w === 'onsite' ? 'On-site' : w.charAt(0).toUpperCase() + w.slice(1)}
                    checked={form.workplace_types.includes(w)}
                    onCheckedChange={() => set('workplace_types', toggle(form.workplace_types, w))}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium text-fg">Experience levels</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {LEVELS.map((l) => (
                  <Checkbox
                    key={l}
                    label={l.charAt(0).toUpperCase() + l.slice(1)}
                    checked={form.experience_levels.includes(l)}
                    onCheckedChange={() => set('experience_levels', toggle(form.experience_levels, l))}
                  />
                ))}
              </div>
            </fieldset>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Minimum salary" hint="Jobs that state a lower maximum are skipped. Leave empty for no minimum.">
              <Input
                type="number"
                min={0}
                value={form.salary_min ?? ''}
                onChange={(e) => set('salary_min', numOrNull(e.target.value))}
              />
            </Field>
            <Field label="Posted within (days)" hint="1–365. Leave empty for any age.">
              <Input
                type="number"
                min={1}
                max={365}
                value={form.posted_within_days ?? ''}
                onChange={(e) => set('posted_within_days', numOrNull(e.target.value))}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Matching" description="How jobs are scored against your profile. Missing profile data is reported as unknown, never as a gap." />
        <CardBody className="space-y-6">
          <Field label={`Minimum match score: ${form.min_match_score}`} hint="Jobs at or above this score are “recommended” and eligible for automatic preparation.">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={form.min_match_score}
              onChange={(e) => set('min_match_score', Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          </Field>
          <div>
            <h3 className="mb-3 text-sm font-medium text-fg">Component weights</h3>
            <WeightSliders
              value={weights}
              defaults={defaults}
              onChange={(w) => {
                setWeights(w)
                setDirty(true)
              }}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Limits & automation" />
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Daily discovery limit" hint="Maximum new jobs stored per day (1–2000).">
              <Input
                type="number"
                min={1}
                max={2000}
                value={form.daily_discovery_limit}
                onChange={(e) => set('daily_discovery_limit', Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
              />
            </Field>
            <Field label="Max applications prepared per day" hint="0–50.">
              <Input
                type="number"
                min={0}
                max={50}
                value={form.max_preparations_per_day}
                onChange={(e) => set('max_preparations_per_day', Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
              />
            </Field>
          </div>
          <Switch
            checked={form.auto_generate_documents}
            onCheckedChange={(v) => set('auto_generate_documents', v)}
            label="Generate tailored documents automatically"
            description="Create a tailored resume and cover letter for jobs above your threshold."
          />
          <Switch
            checked={form.auto_prepare_applications}
            onCheckedChange={(v) => set('auto_prepare_applications', v)}
            label="Prepare applications automatically"
            description="Inspect application forms and map your answers so drafts are ready for review."
          />
          <fieldset>
            <legend className="text-sm font-medium text-fg">Application mode</legend>
            <div className="mt-2 grid gap-3 md:grid-cols-3" role="radiogroup">
              {MODES.map((m) => {
                const checked = form.application_mode === m.value
                return (
                  <label
                    key={m.value}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors',
                      checked ? 'border-primary bg-primary-soft' : 'border-border-strong hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${ids}-mode`}
                      value={m.value}
                      checked={checked}
                      onChange={() => chooseMode(m.value)}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="block font-medium text-fg">{m.label}</span>
                      <span className="mt-0.5 block text-xs text-subtle">{m.description}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            {form.application_mode === 'authorized' && (
              <Alert tone="warning" className="mt-3" title="Authorized automation is selected">
                {config.authorized_automation_ack_at
                  ? `Acknowledged on ${formatDate(config.authorized_automation_ack_at, true)}.`
                  : 'Your acknowledgement will be recorded when you save.'}
              </Alert>
            )}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Documents & AI" />
        <CardBody className="space-y-5">
          <Field label="Resume template" hint={templates.data?.templates.find((t) => t.key === form.resume_template)?.description}>
            <Select value={form.resume_template} onChange={(e) => set('resume_template', e.target.value)} disabled={!templates.data}>
              {!templates.data && <option value={form.resume_template}>{form.resume_template}</option>}
              {templates.data?.templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Switch
            checked={form.use_llm}
            onCheckedChange={(v) => set('use_llm', v)}
            label="Use AI when generating documents"
            description="Requires a configured AI provider. Every AI suggestion is fact-checked against your profile."
          />
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <span id={`${ids}-status`} className="mr-auto text-sm text-subtle" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
        </span>
        <Button type="submit" loading={saving} disabled={!dirty || allZero}>
          <Save className="h-4 w-4" aria-hidden="true" /> Save settings
        </Button>
      </div>

      <AuthorizedModeDialog
        open={authDialog}
        onOpenChange={setAuthDialog}
        onConfirm={() => {
          setForm((f) => ({ ...f, application_mode: 'authorized', acknowledge_authorized_automation: true }))
          setDirty(true)
          setAuthDialog(false)
        }}
      />
    </form>
  )
}
