import { useQuery } from '@tanstack/react-query'
import { ErrorState, LoadingState, SectionTitle } from '@/components/ui'
import { resumeService } from '@/services/documents'
import { ResumeContentView } from './ResumeContentView'

export function CompareView({ versionId }: { versionId: string }) {
  const q = useQuery({ queryKey: ['resume-versions', 'compare', versionId], queryFn: () => resumeService.compare(versionId) })
  if (q.isPending) return <LoadingState label="Loading comparison…" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border p-4">
        <SectionTitle className="mb-3">Original (from your profile)</SectionTitle>
        <ResumeContentView content={q.data.original} />
      </div>
      <div className="rounded-lg border border-primary/30 bg-primary-soft/30 p-4">
        <SectionTitle className="mb-3">Tailored (this version)</SectionTitle>
        <ResumeContentView content={q.data.tailored} />
      </div>
    </div>
  )
}
