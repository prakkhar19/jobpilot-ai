import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert, Button, Dialog, Field, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { sourceService } from '@/services/integrations'
import { jobService } from '@/services/jobs'
import type { JobDetail, WorkplaceType } from '@/types/api'
import { humanize } from '@/utils/format'

const EMPTY = { title: '', company: '', description: '', location: '', url: '', workplace_type: 'unknown' as WorkplaceType, employment_type: '' }

export function ImportJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState('url')
  const [url, setUrl] = useState('')
  const [manual, setManual] = useState(EMPTY)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const catalog = useQuery({ queryKey: ['sources', 'catalog'], queryFn: sourceService.catalog, enabled: open, staleTime: 300_000 })
  const unsupported = catalog.data?.unsupported ?? []

  const done = (job: JobDetail) => {
    void qc.invalidateQueries({ queryKey: ['jobs'] })
    toast.success('Job imported', { description: `${job.title} at ${job.company}` })
    onOpenChange(false)
    setUrl('')
    setManual(EMPTY)
    navigate(`/jobs/${job.id}`)
  }

  const submitUrl = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    let err: string | null = null
    try {
      const u = new URL(url.trim())
      if (!/^https?:$/.test(u.protocol)) err = 'Use an http(s) URL.'
    } catch {
      err = 'Enter a valid URL, e.g. https://boards.greenhouse.io/acme/jobs/123'
    }
    setErrors({ url: err })
    if (err) return
    setBusy(true)
    try {
      done(await jobService.importUrl(url.trim()))
    } catch (e2) {
      setFormError(errorMessage(e2))
    } finally {
      setBusy(false)
    }
  }

  const submitManual = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const next = {
      title: manual.title.trim() ? null : 'Title is required.',
      company: manual.company.trim() ? null : 'Company is required.',
      description: manual.description.trim().length >= 20 ? null : 'Paste the full job description (at least 20 characters).',
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    setBusy(true)
    try {
      done(
        await jobService.importManual({
          ...manual,
          title: manual.title.trim(),
          company: manual.company.trim(),
          url: manual.url.trim(),
        }),
      )
    } catch (e2) {
      setFormError(errorMessage(e2))
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setManual((m) => ({ ...m, [k]: e.target.value }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Import a job"
      description="Add a posting the agent did not discover. It is analyzed and matched against your profile."
    >
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setFormError(null); setErrors({}) }}>
        <TabsList aria-label="Import method">
          <TabsTrigger value="url">By URL</TabsTrigger>
          <TabsTrigger value="text">Paste text</TabsTrigger>
        </TabsList>
        {formError && <Alert tone="danger" className="mt-4">{formError}</Alert>}
        <TabsContent value="url">
          <form onSubmit={submitUrl} noValidate className="space-y-4">
            <Field label="Posting URL" error={errors.url} hint="Works for Greenhouse, Lever, Ashby and career pages that publish schema.org job data." required>
              <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://jobs.lever.co/acme/…" />
            </Field>
            <Alert tone="info" title="LinkedIn, Indeed and similar sites can't be fetched">
              {unsupported.length > 0 ? (
                <>
                  These platforms don't allow automated access, so paste the description instead:{' '}
                  {unsupported.map((u) => humanize(u.platform)).join(', ')}.
                </>
              ) : (
                'Platforms that prohibit automated access must be imported by pasting the text.'
              )}{' '}
              <button type="button" className="underline" onClick={() => setTab('text')}>
                Paste text instead
              </button>
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Import</Button>
            </div>
          </form>
        </TabsContent>
        <TabsContent value="text">
          <form onSubmit={submitManual} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job title" error={errors.title} required>
                <Input value={manual.title} onChange={set('title')} />
              </Field>
              <Field label="Company" error={errors.company} required>
                <Input value={manual.company} onChange={set('company')} />
              </Field>
              <Field label="Location">
                <Input value={manual.location} onChange={set('location')} />
              </Field>
              <Field label="Workplace">
                <Select value={manual.workplace_type} onChange={set('workplace_type')}>
                  <option value="unknown">Unspecified</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                </Select>
              </Field>
              <Field label="Employment type" hint="e.g. Full-time">
                <Input value={manual.employment_type} onChange={set('employment_type')} />
              </Field>
              <Field label="Original posting URL" hint="Optional — used for the “Open posting” link.">
                <Input type="url" value={manual.url} onChange={set('url')} />
              </Field>
            </div>
            <Field label="Job description" error={errors.description} hint="Paste the full text including requirements." required>
              <Textarea rows={10} value={manual.description} onChange={set('description')} />
            </Field>
            {unsupported.length > 0 && (
              <p className="text-xs text-subtle">
                Use this for {unsupported.map((u) => humanize(u.platform)).join(', ')} — copy the posting text from your browser.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Import</Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
