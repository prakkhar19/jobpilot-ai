import { useState } from 'react'
import { Checkbox, ConfirmDialog } from '@/components/ui'

export function AuthorizedModeDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const [ack, setAck] = useState(false)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setAck(false)
        onOpenChange(o)
      }}
      title="Enable authorized automation?"
      description="The agent will be allowed to submit applications on your behalf without asking first."
      confirmLabel="Enable authorized mode"
      confirmDisabled={!ack}
      onConfirm={() => {
        onConfirm()
        setAck(false)
      }}
    >
      <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm text-muted">
        <li>Only sites whose integration supports automated submission are submitted automatically.</li>
        <li>Every required answer must come from verified data (profile, application facts, answer bank or you).</li>
        <li>The match score must meet your minimum threshold; anything else still waits for your approval.</li>
        <li>CAPTCHAs and login walls always stop automation. Every action is recorded in the audit trail.</li>
        <li>You remain responsible for every application sent in your name.</li>
      </ul>
      <Checkbox
        checked={ack}
        onCheckedChange={setAck}
        label="I understand and authorize JobPilot AI to submit applications for me under these rules."
      />
    </ConfirmDialog>
  )
}
