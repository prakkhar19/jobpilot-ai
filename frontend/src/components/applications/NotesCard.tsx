import { useState } from 'react'
import { Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { applicationService } from '@/services/applications'
import type { Application, ApplicationUpdate } from '@/types/api'
import { toDateInput } from '@/utils/format'
import { APPLICATION_KEY } from './helpers'

export function NotesCard({ app }: { app: Application }) {
  const [notes, setNotes] = useState(app.notes ?? '')
  const [followUp, setFollowUp] = useState(toDateInput(app.follow_up_date))
  const save = useMutationToast({
    mutationFn: (body: ApplicationUpdate) => applicationService.update(app.id, body),
    success: 'Notes saved',
    error: 'Could not save notes',
    invalidate: [APPLICATION_KEY(app.id), ['applications', 'list']],
  })
  const dirty = notes !== (app.notes ?? '') || followUp !== toDateInput(app.follow_up_date)

  const submit = () => {
    const body: ApplicationUpdate = { notes }
    if (followUp) body.follow_up_date = followUp
    else if (app.follow_up_date) body.clear_follow_up = true
    save.mutate(body)
  }

  return (
    <Card>
      <CardHeader title="Notes & follow-up" />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="Notes">
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter name, referral, salary discussed…" />
          </Field>
          <Field label="Follow-up date" hint="Leave empty to clear the reminder.">
            <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty} loading={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
