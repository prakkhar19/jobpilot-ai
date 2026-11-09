import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { errorMessage } from '@/services/api'
import { AuthCard } from './AuthCard'
import { MIN_PASSWORD_LENGTH, validateEmail, validateNewPassword } from './validation'

export default function RegisterPage() {
  const { register, status } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status && !status.registration_open) {
    return (
      <AuthCard
        title="Registration closed"
        footer={
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-muted">
          This JobPilot AI server is not accepting new accounts
          {status.single_user_mode ? ' (it runs in single-user mode and already has an owner)' : ''}. Ask the administrator
          for access.
        </p>
      </AuthCard>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const next = {
      email: validateEmail(email),
      password: validateNewPassword(password),
      confirm: confirm !== password ? 'Passwords do not match.' : null,
      fullName: fullName.length > 200 ? 'Name is too long.' : null,
    }
    setErrors(next)
    setFormError(null)
    if (Object.values(next).some(Boolean)) return
    setSubmitting(true)
    try {
      await register(email.trim(), password, fullName.trim())
      navigate('/onboarding', { replace: true })
    } catch (err) {
      setFormError(errorMessage(err, 'Registration failed.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description={status?.single_user_mode ? 'The first account becomes the owner of this server.' : 'Start your AI-assisted job search.'}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field label="Full name" error={errors.fullName}>
          <Input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email" error={errors.email} required>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={errors.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} required>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" error={errors.confirm} required>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
