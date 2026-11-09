import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { errorMessage } from '@/services/api'
import { AuthCard } from './AuthCard'
import { validateEmail } from './validation'

export default function LoginPage() {
  const { login, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const next = { email: validateEmail(email), password: password ? null : 'Password is required.' }
    setErrors(next)
    setFormError(null)
    if (next.email || next.password) return
    setSubmitting(true)
    try {
      const s = await login(email.trim(), password)
      if (s.user && !s.user.onboarding_completed) navigate('/onboarding', { replace: true })
      else navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (err) {
      setFormError(errorMessage(err, 'Sign-in failed.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      title="Sign in to JobPilot AI"
      description="Your self-hosted job-search copilot."
      footer={
        status?.registration_open ? (
          <>
            New here?{' '}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        ) : null
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field label="Email" error={errors.email} required>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={errors.password} required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  )
}
