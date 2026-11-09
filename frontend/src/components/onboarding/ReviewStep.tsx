import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
import { fromDraft, toDraft, type ProfileDraft } from '@/components/profile/profileDraft'
import { ProfileStatusBadges } from '@/components/profile/ProfileStatusBadges'
import { Alert, Button, EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { profileService } from '@/services/profiles'
import type { Profile } from '@/types/api'
import { StepFrame } from './StepFrame'

function Editor({ profile, onDone, nav }: { profile: Profile; onDone: () => void; nav: (primary: ReactNode) => ReactNode }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const approve = async () => {
    setSaving(true)
    setError(null)
    try {
      await profileService.update(profile.id, fromDraft(draft))
      await profileService.approve(profile.id)
      void qc.invalidateQueries({ queryKey: ['profiles'] })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <StepFrame
      title="Review your profile"
      description="Check what was extracted, fix anything that is wrong, then approve. Only approved facts are ever used."
      footer={nav(
        <Button onClick={approve} loading={saving}>
          Save & approve
        </Button>,
      )}
    >
      <div className="mb-4 flex items-center gap-2 text-sm text-subtle">
        Status: <ProfileStatusBadges status={profile.status} isActive={profile.is_active} />
      </div>
      {profile.parse_warnings.length > 0 && (
        <Alert tone="warning" title="Please double-check" className="mb-4">
          <ul className="list-disc space-y-0.5 pl-5">
            {profile.parse_warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <ProfileEditor value={draft} onChange={setDraft} />
    </StepFrame>
  )
}

/** Step 2: edit + approve the active profile (GET /api/profiles/active). */
export function ReviewStep({ onDone, nav }: { onDone: () => void; nav: (primary: ReactNode) => ReactNode }) {
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['profiles', 'active'],
    queryFn: profileService.active,
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const createBlank = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      await profileService.create()
      await qc.invalidateQueries({ queryKey: ['profiles'] })
    } catch (err) {
      setCreateError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  if (isPending)
    return (
      <StepFrame title="Review your profile" footer={nav(null)}>
        <LoadingState label="Loading your profile…" />
      </StepFrame>
    )
  if (isError)
    return (
      <StepFrame title="Review your profile" footer={nav(null)}>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </StepFrame>
    )
  if (!data)
    return (
      <StepFrame title="Review your profile" footer={nav(null)}>
        <EmptyState
          title="No profile yet"
          description="Go back and upload a resume, or start with a blank profile and fill it in by hand."
          action={
            <Button onClick={createBlank} loading={creating}>
              Create a blank profile
            </Button>
          }
        />
        {createError && <Alert tone="danger">{createError}</Alert>}
      </StepFrame>
    )
  return <Editor key={`${data.id}-${data.version}`} profile={data} onDone={onDone} nav={nav} />
}
