import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LogOut, PartyPopper } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { PreferencesStep } from '@/components/onboarding/PreferencesStep'
import { ProviderStep } from '@/components/onboarding/ProviderStep'
import { ReviewStep } from '@/components/onboarding/ReviewStep'
import { SourcesStep } from '@/components/onboarding/SourcesStep'
import { StepFrame } from '@/components/onboarding/StepFrame'
import { Stepper } from '@/components/onboarding/Stepper'
import { ResumeUpload } from '@/components/profile/ResumeUpload'
import { useAiAvailable } from '@/components/profile/useAiAvailable'
import { DiscoveryRunner } from '@/components/shared/DiscoveryRunner'
import { Button } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { errorMessage } from '@/services/api'
import { authService } from '@/services/auth'

const STEPS = ['Upload resume', 'Review profile', 'AI provider', 'Preferences', 'Job sources', 'Done']

export default function OnboardingPage() {
  const { user, setUser, logout } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { available: aiAvailable } = useAiAvailable()
  const [step, setStep] = useState(0)
  const [finishing, setFinishing] = useState(false)

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))

  const finish = async () => {
    setFinishing(true)
    try {
      const updated = await authService.updateMe({ onboarding_completed: true })
      setUser(updated)
      navigate('/', { replace: true })
    } catch (err) {
      toast.error('Could not complete setup', { description: errorMessage(err) })
    } finally {
      setFinishing(false)
    }
  }

  const doLogout = async () => {
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (err) {
      toast.error('Logout failed', { description: errorMessage(err) })
    }
  }

  /** Footer: Back on the left; on the right either "Skip for now" + the step's primary action, or "Continue". */
  const nav = (primary: ReactNode, nextLabel = 'Continue') => (
    <>
      <div>
        {step > 0 && (
          <Button variant="ghost" onClick={back}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {primary ? (
          <>
            <Button variant="ghost" onClick={next}>
              Skip for now
            </Button>
            {primary}
          </>
        ) : (
          <Button onClick={next}>{nextLabel}</Button>
        )}
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={finish} disabled={finishing}>
            Skip setup
          </Button>
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => void doLogout()} aria-label="Log out">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Welcome{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''} — let's set up JobPilot AI
          </h1>
          <p className="mt-1 text-sm text-subtle">
            Step {step + 1} of {STEPS.length}. Optional steps can be skipped and finished later.
          </p>
        </div>
        <div className="mb-6">
          <Stepper steps={STEPS} current={step} />
        </div>

        {step === 0 && (
          <StepFrame
            title="Upload your resume"
            description="We extract a structured profile from it. Nothing is sent anywhere unless you enable AI extraction with your own provider."
            footer={nav(null, 'Skip')}
          >
            <ResumeUpload
              aiAvailable={aiAvailable}
              showLabel={false}
              submitLabel="Upload & continue"
              onUploaded={() => {
                void qc.invalidateQueries({ queryKey: ['profiles'] })
                void qc.invalidateQueries({ queryKey: ['master-resumes'] })
                next()
              }}
            />
          </StepFrame>
        )}
        {step === 1 && <ReviewStep onDone={next} nav={nav} />}
        {step === 2 && <ProviderStep nav={nav} />}
        {step === 3 && <PreferencesStep onDone={next} nav={nav} />}
        {step === 4 && <SourcesStep nav={nav} />}
        {step === 5 && (
          <StepFrame
            title="You're all set"
            description="Run your first discovery now, or finish and explore the dashboard."
            footer={
              <>
                <Button variant="ghost" onClick={back}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
                </Button>
                <Button onClick={finish} loading={finishing}>
                  Finish & go to dashboard
                </Button>
              </>
            }
          >
            <div className="flex flex-col items-start gap-4">
              <div className="flex items-center gap-3 text-sm text-muted">
                <PartyPopper className="h-5 w-5 text-primary" aria-hidden="true" />
                Discovery fetches jobs from your sources, analyzes them and scores each against your approved profile.
              </div>
              <DiscoveryRunner label="Run first discovery" />
            </div>
          </StepFrame>
        )}
      </main>
    </div>
  )
}
