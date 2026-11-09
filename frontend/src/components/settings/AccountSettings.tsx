import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { errorMessage } from '@/services/api'
import { authService } from '@/services/auth'
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '@/pages/auth/validation'

export function AccountSettings() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user?.full_name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwErrors, setPwErrors] = useState<Record<string, string | null>>({})
  const [savingPw, setSavingPw] = useState(false)

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    setSavingName(true)
    try {
      const u = await authService.updateMe({ full_name: name.trim() })
      setUser(u)
      toast.success('Name updated')
    } catch (err) {
      toast.error('Could not update name', { description: errorMessage(err) })
    } finally {
      setSavingName(false)
    }
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    const errs = {
      current: current ? null : 'Enter your current password.',
      next: validateNewPassword(next),
      confirm: confirm !== next ? 'Passwords do not match.' : null,
    }
    setPwErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setSavingPw(true)
    try {
      await authService.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('Password changed', { description: 'Your other sessions were signed out.' })
    } catch (err) {
      toast.error('Could not change password', { description: errorMessage(err) })
    } finally {
      setSavingPw(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile" description={`Signed in as ${user?.email ?? ''}`} />
        <CardBody>
          <form onSubmit={saveName} className="space-y-4">
            <Field label="Full name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" />
            </Field>
            <Button type="submit" loading={savingName} disabled={name.trim() === (user?.full_name ?? '')}>
              Save name
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change password" description="Changing your password signs out all other sessions." />
        <CardBody>
          <form onSubmit={changePassword} noValidate className="space-y-4">
            <Field label="Current password" error={pwErrors.current} required>
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" error={pwErrors.next} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} required>
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirm new password" error={pwErrors.confirm} required>
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" loading={savingPw}>
              Change password
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
