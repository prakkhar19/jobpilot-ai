import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, Plus, Save, Star, Trash2, Upload, UserRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
import { fromDraft, toDraft, type ProfileDraft } from '@/components/profile/profileDraft'
import { ProfileStatusBadges } from '@/components/profile/ProfileStatusBadges'
import { ResumeFilesList } from '@/components/profile/ResumeFilesList'
import { ResumeUpload } from '@/components/profile/ResumeUpload'
import { useAiAvailable } from '@/components/profile/useAiAvailable'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@/components/ui'
import { useMutationToast } from '@/hooks/useMutationToast'
import { errorMessage } from '@/services/api'
import { profileService } from '@/services/profiles'
import type { Profile } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatRelative, humanize } from '@/utils/format'

const PROFILES_KEY = ['profiles'] as const

function ProfileForm({ profile, onDeleted, onSelect }: {
  profile: Profile
  onDeleted: () => void
  onSelect: (id: string) => void
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = (p?: Profile) => {
    if (p) qc.setQueryData(['profiles', p.id], p)
    void qc.invalidateQueries({ queryKey: PROFILES_KEY })
  }

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (err) {
      toast.error('Action failed', { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('save', async () => {
      const p = await profileService.update(profile.id, fromDraft(draft))
      setDirty(false)
      refresh(p)
      toast.success('Profile saved')
    })

  const approve = () =>
    run('approve', async () => {
      if (dirty) {
        await profileService.update(profile.id, fromDraft(draft))
        setDirty(false)
      }
      const p = await profileService.approve(profile.id)
      refresh(p)
      toast.success('Profile approved', { description: 'It is now active and will be used for matching and resumes.' })
    })

  const activate = () =>
    run('activate', async () => {
      const p = await profileService.activate(profile.id)
      refresh(p)
      toast.success('Profile activated')
    })

  const duplicate = () =>
    run('duplicate', async () => {
      const p = await profileService.duplicate(profile.id)
      refresh()
      onSelect(p.id)
      toast.success('Profile duplicated')
    })

  const remove = () =>
    run('delete', async () => {
      await profileService.remove(profile.id)
      setConfirmDelete(false)
      qc.removeQueries({ queryKey: ['profiles', profile.id] })
      refresh()
      onDeleted()
      toast.success('Profile deleted')
    })

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-fg">{profile.label || 'Untitled profile'}</h2>
              <ProfileStatusBadges status={profile.status} isActive={profile.is_active} />
            </div>
            <p className="mt-0.5 text-xs text-subtle">
              Version {profile.version} · parsed by {humanize(profile.parse_method || 'manual')} · updated {formatRelative(profile.updated_at)}
              {dirty && <span className="ml-1 font-medium text-warning">· unsaved changes</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={busy === 'save'} disabled={!!busy && busy !== 'save'}>
              <Save className="h-4 w-4" aria-hidden="true" /> Save
            </Button>
            {(profile.status !== 'approved' || dirty) && (
              <Button variant="outline" onClick={approve} loading={busy === 'approve'} disabled={!!busy && busy !== 'approve'}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {dirty ? 'Save & approve' : 'Approve'}
              </Button>
            )}
            {!profile.is_active && (
              <Button variant="outline" onClick={activate} loading={busy === 'activate'} disabled={!!busy && busy !== 'activate'}>
                <Star className="h-4 w-4" aria-hidden="true" /> Make active
              </Button>
            )}
            <Button variant="outline" onClick={duplicate} loading={busy === 'duplicate'} disabled={!!busy && busy !== 'duplicate'}>
              <Copy className="h-4 w-4" aria-hidden="true" /> Duplicate
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete profile">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Card>
      {profile.status !== 'approved' && (
        <Alert tone="warning" title="This profile is a draft">
          Review the extracted details, then approve it. Only approved profiles are used for matching and document generation.
        </Alert>
      )}
      {profile.parse_warnings.length > 0 && (
        <Alert tone="info" title="Extraction notes">
          <ul className="list-disc space-y-0.5 pl-5">
            {profile.parse_warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      <ProfileEditor
        value={draft}
        onChange={(d) => {
          setDraft(d)
          setDirty(true)
        }}
      />
      <div className="flex justify-end">
        <Button onClick={save} loading={busy === 'save'} disabled={!!busy && busy !== 'save'}>
          <Save className="h-4 w-4" aria-hidden="true" /> Save profile
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this profile?"
        description="This permanently removes the profile. Generated documents are kept."
        confirmLabel="Delete profile"
        destructive
        loading={busy === 'delete'}
        onConfirm={remove}
      />
    </div>
  )
}

function ProfileDetail({ id, onDeleted, onSelect }: { id: string; onDeleted: () => void; onSelect: (id: string) => void }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['profiles', id],
    queryFn: () => profileService.get(id),
  })
  if (isPending) return <LoadingState label="Loading profile…" />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />
  return <ProfileForm key={`${data.id}-${data.version}-${data.status}`} profile={data} onDeleted={onDeleted} onSelect={onSelect} />
}

export default function ProfilePage() {
  const qc = useQueryClient()
  const { available: aiAvailable } = useAiAvailable()
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: PROFILES_KEY, queryFn: profileService.list })
  const [selected, setSelected] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const effectiveId =
    data && data.length
      ? data.some((p) => p.id === selected)
        ? selected
        : (data.find((p) => p.is_active) ?? data[0]).id
      : null

  const create = useMutationToast({
    mutationFn: () => profileService.create(),
    success: 'Blank profile created',
    error: 'Could not create profile',
    invalidate: [PROFILES_KEY],
    onSuccess: (p) => setSelected(p.id),
  })

  const actions = (
    <>
      <Button variant="outline" onClick={() => setUploadOpen(true)}>
        <Upload className="h-4 w-4" aria-hidden="true" /> Upload resume
      </Button>
      <Button onClick={() => create.mutate()} loading={create.isPending}>
        <Plus className="h-4 w-4" aria-hidden="true" /> New blank profile
      </Button>
    </>
  )

  return (
    <div>
      <PageHeader
        title="Candidate profile"
        description="Your verified facts. JobPilot only uses what is in your approved profile — it never invents skills or experience."
        actions={actions}
      />
      {isPending && <LoadingState />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <Card>
          <EmptyState
            icon={<UserRound className="h-5 w-5" />}
            title="No profile yet"
            description="Upload your resume to extract a profile automatically, or start from a blank one."
            action={actions}
          />
        </Card>
      )}
      {data && data.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="Profiles" description="The active profile is used by the agent." />
              <ul className="p-2" aria-label="Profiles">
                {data.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(p.id)}
                      aria-current={effectiveId === p.id ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-lg px-3 py-2 text-left',
                        effectiveId === p.id ? 'bg-primary-soft' : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="block truncate text-sm font-medium text-fg">{p.label || 'Untitled profile'}</span>
                      <span className="block truncate text-xs text-subtle">
                        {p.full_name || 'No name'} · v{p.version} · {humanize(p.parse_method || 'manual')}
                      </span>
                      <span className="mt-1 block">
                        <ProfileStatusBadges status={p.status} isActive={p.is_active} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="min-w-0">
            {effectiveId && (
              <ProfileDetail key={effectiveId} id={effectiveId} onDeleted={() => setSelected(null)} onSelect={setSelected} />
            )}
          </div>
        </div>
      )}
      <div className="mt-8">
        <ResumeFilesList />
      </div>
      <Dialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="Upload another resume"
        description="A new draft profile is created from the file. Your existing profiles are not changed."
      >
        <ResumeUpload
          aiAvailable={aiAvailable}
          onUploaded={(r) => {
            setUploadOpen(false)
            void qc.invalidateQueries({ queryKey: PROFILES_KEY })
            void qc.invalidateQueries({ queryKey: ['master-resumes'] })
            setSelected(r.profile.id)
          }}
        />
      </Dialog>
    </div>
  )
}
