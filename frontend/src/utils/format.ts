export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—'
  const diff = Date.now() - new Date(value).getTime()
  if (Number.isNaN(diff)) return value
  const abs = Math.abs(diff)
  if (abs < 45_000) return diff < 0 ? 'in a moment' : 'just now'
  const steps: [number, number, string][] = [
    [3_600_000, 60_000, 'minute'],
    [86_400_000, 3_600_000, 'hour'],
    [604_800_000, 86_400_000, 'day'],
  ]
  const step = steps.find(([limit]) => abs < limit)
  if (!step) return formatDate(value)
  const n = Math.max(1, Math.round(abs / step[1]))
  const text = `${n} ${step[2]}${n === 1 ? '' : 's'}`
  return diff < 0 ? `in ${text}` : `${text} ago`
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatSalary(job: {
  salary_min: number | null
  salary_max: number | null
  salary_currency: string
  salary_text: string
}): string {
  if (job.salary_text) return job.salary_text
  const cur = job.salary_currency || ''
  const f = (n: number) => `${cur} ${Math.round(n).toLocaleString()}`.trim()
  if (job.salary_min && job.salary_max) return `${f(job.salary_min)} – ${f(job.salary_max)}`
  if (job.salary_min) return `from ${f(job.salary_min)}`
  if (job.salary_max) return `up to ${f(job.salary_max)}`
  return ''
}

export function humanize(key: string): string {
  if (!key) return ''
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 10)
}

/** Converts an ISO timestamp to a value for <input type="datetime-local"> in local time. */
export function toDateTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromDateTimeInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
