import { Badge } from '@/components/ui'

export function ProfileStatusBadges({ status, isActive }: { status: string; isActive: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={status === 'approved' ? 'success' : 'warning'}>{status === 'approved' ? 'Approved' : 'Draft'}</Badge>
      {isActive && <Badge tone="primary">Active</Badge>}
    </span>
  )
}
