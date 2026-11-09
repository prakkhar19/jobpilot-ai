import { useState } from 'react'
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui'
import { APPLICATION_STATUS_LABELS } from '@/utils/constants'

export function MarkSubmittedDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onConfirm: (note: string, date: string | null) => void
  loading?: boolean
}) {
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mark as submitted"
      description="Use this after you submitted the application yourself on the employer's site."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(note.trim(), date || null)} loading={loading}>
            Mark as submitted
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Submitted on" hint="Leave empty for today.">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note or confirmation (optional)">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. confirmation number" />
        </Field>
      </div>
    </Dialog>
  )
}

export function StatusDialog({
  open,
  onOpenChange,
  current,
  manual,
  labels,
  onConfirm,
  loading,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  current: string
  manual: string[]
  labels: Record<string, string>
  onConfirm: (status: string, note: string) => void
  loading?: boolean
}) {
  const [status, setStatus] = useState(manual.includes(current) ? current : '')
  const [note, setNote] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change status"
      description="Record what happened with the employer. Only manual statuses can be set here."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(status, note.trim())} loading={loading} disabled={!status || status === current}>
            Update status
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="New status" required>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Select a status…</option>
            {manual.map((s) => (
              <option key={s} value={s}>
                {labels[s] ?? APPLICATION_STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}
