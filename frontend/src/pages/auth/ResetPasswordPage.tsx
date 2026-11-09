import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { authService } from '@/services/auth'
import { AuthCard } from './AuthCard'
import { MIN_PASSWORD_LENGTH, validateNewPassword } from './validation'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const next = {
      password: validateNewPassword(password),
      confirm: confirm !== password ? 'Passwords do not match.' : null,
    }
    setErrors(next)
    setFormError(null)
    if (next.password || next.confirm) return
    setSubmitting(true)
    try {
      await authService.confirmReset(token, password)
      setDone(true)
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const footer = (
    <Link to="/login" className="font-medium text-primary hover:underline">
      Back to sign in
    </Link>
  )

  if (token.length < 10) {
    return (
      <AuthCard title="Invalid reset link" footer={footer}>
        <p className="text-sm text-muted">
          This password reset link is missing its token or is malformed.{' '}
          <Link to="/forgot-password" className="text-primary hover:underline">
            Request a new link
          </Link>
          .
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password" footer={footer}>
      {done ? (
        <Alert tone="success" title="Password updated">
          You can now <Link to="/login" className="underline">sign in</Link> with your new password. Other sessions were signed out.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="New password" error={errors.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} required>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm new password" error={errors.confirm} required>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={submitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
