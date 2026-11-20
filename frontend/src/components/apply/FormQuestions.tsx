import { useMutation } from '@tanstack/react-query'
import { Copy, MessageCircleQuestion, UserPen } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Textarea } from '@/components/ui'
import { applyQueueService } from '@/services/applyQueue'
import { errorMessage } from '@/services/api'

/** Paste the free-text questions from an application form and get answers drafted from your profile. */
export function FormQuestions({ jobId, company }: { jobId: string; company: string }) {
  const [text, setText] = useState('')
  const answers = useMutation({
    mutationFn: () => applyQueueService.answers(jobId, text),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Answer copied')
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.')
    }
  }

  return (
    <details className="group rounded-lg border border-border bg-surface-2/50 px-4 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden="true" />
        Questions on the application form?
      </summary>
      <div className="mt-3 space-y-3 pb-2">
        <label htmlFor={`q-${jobId}`} className="block text-xs text-subtle">
          Paste the questions {company} asks (copy the whole question with its hint text). Answers use only facts from
          your profile, so check them and edit if needed before you submit.
        </label>
        <Textarea
          id={`q-${jobId}`}
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Relevant experience *\nRoles, tenure, and specifics that match this opening…\n\nWhy this role at the company? *'}
        />
        <Button
          size="sm"
          onClick={() => answers.mutate()}
          loading={answers.isPending}
          disabled={text.trim().length < 3}
        >
          Write my answers
        </Button>

        {answers.data && (
          <ol className="space-y-3">
            {answers.data.map((a, i) => (
              <li key={i} className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs font-medium text-subtle">{a.question}</p>
                {a.method === 'needs_you' ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-warning">
                    <UserPen className="h-4 w-4" aria-hidden="true" />
                    {a.note || 'Only you can answer this one.'}
                  </p>
                ) : (
                  <>
                    <p className="mt-2 whitespace-pre-line">{a.answer}</p>
                    {a.note && <p className="mt-1 text-[11px] text-subtle">{a.note}</p>}
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => void copy(a.answer)}>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy answer
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}
