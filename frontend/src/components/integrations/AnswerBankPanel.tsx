import { useQuery } from '@tanstack/react-query'
import { MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Textarea,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { answerBankService } from '@/services/integrations'
import type { ScreeningAnswer } from '@/types/api'
import { formatRelative } from '@/utils/format'

const KEY = ['screening-answers'] as const

function AnswerDialog({ answer, open, onClose }: { answer: ScreeningAnswer | null; open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState(answer?.question_text ?? '')
  const [text, setText] = useState(answer?.answer ?? '')
  const save = useMutationToast({
    mutationFn: () => answerBankService.upsert(question.trim(), text.trim()),
    success: answer ? 'Answer updated' : 'Answer saved',
    error: 'Could not save answer',
    invalidate: [KEY],
    onSuccess: onClose,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (question.trim() && text.trim()) save.mutate()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={answer ? 'Edit answer' : 'Add screening answer'}
      description="Saved answers are reused when an application form asks the same question."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Question" required hint={answer ? 'Questions are matched by their text; it cannot be changed here.' : 'e.g. "Are you legally authorized to work in the US?"'}>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={!!answer} />
        </Field>
        <Field label="Answer" required>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!question.trim() || !text.trim()}>
            Save answer
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function AnswerBankPanel() {
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: KEY, queryFn: answerBankService.list })
  const [editing, setEditing] = useState<ScreeningAnswer | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ScreeningAnswer | null>(null)
  const remove = useMutationToast({
    mutationFn: (id: string) => answerBankService.remove(id),
    success: 'Answer deleted',
    error: 'Could not delete answer',
    invalidate: [KEY],
    onSuccess: () => setDeleting(null),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-subtle">
          Answers you give to screening questions are stored here and reused automatically. JobPilot never guesses an answer.
        </p>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add answer
        </Button>
      </div>
      <Card>
        {isPending && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && data.length === 0 && (
          <EmptyState
            icon={<MessageSquareText className="h-5 w-5" />}
            title="No saved answers"
            description="Answers are added here when you fill missing questions on an application, or you can add them now."
          />
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-border">
            {data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{a.question_text}</p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted">{a.answer}</p>
                  <p className="mt-0.5 text-xs text-subtle">Updated {formatRelative(a.updated_at)}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(a)} aria-label={`Edit answer to ${a.question_text}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(a)} aria-label={`Delete answer to ${a.question_text}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing !== null && (
        <AnswerDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          answer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete saved answer?"
        description={deleting?.question_text}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  )
}
