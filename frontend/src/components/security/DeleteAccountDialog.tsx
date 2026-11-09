import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert, Button, Dialog, Field, Input } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { authService } from '@/services/auth'
import { AUTH_QUERY_KEY } from '@/context/auth'
import type { AuthStatus } from '@/types/api'

export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canSubmit = password.length > 0 && confirm === 'DELETE'

  const close = (o: boolean) => {
    if (!o) {
      setPassword('')
      setConfirm('')
      setError(null)
    }
    onOpenChange(o)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await authService.deleteAccount(password, confirm)
      const prev = qc.getQueryData<AuthStatus>(AUTH_QUERY_KEY)
      qc.clear()
      qc.setQueryData<AuthStatus>(AUTH_QUERY_KEY, {
        registration_open: prev?.registration_open ?? false,
        single_user_mode: prev?.single_user_mode ?? false,
        demo_mode: prev?.demo_mode ?? false,
        user: null,
        csrf_token: null,
      })
      toast.success('Your account and all its data were deleted.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Delete your account"
      description="This permanently deletes your profile, resumes, jobs, applications, documents, API keys and history. It cannot be undone."
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="delete-account-form" loading={busy} disabled={!canSubmit}>
            Delete account permanently
          </Button>
        </>
      }
    >
      <form id="delete-account-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm text-muted">Consider exporting your data first.</p>
        <Field label="Current password" required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={<>Type <strong>DELETE</strong> to confirm</>} required>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      </form>
    </Dialog>
  )
}
