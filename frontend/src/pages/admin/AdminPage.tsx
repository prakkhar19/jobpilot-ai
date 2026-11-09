import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { useMutationToast } from '@/hooks/useMutationToast'
import { systemService } from '@/services/agent'
import type { AdminUser } from '@/types/api'
import { formatDate, formatRelative } from '@/utils/format'

const KEY = ['admin', 'users'] as const

export default function AdminPage() {
  const { user: me } = useAuth()
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: KEY, queryFn: systemService.adminUsers })
  const [target, setTarget] = useState<AdminUser | null>(null)
  const toggle = useMutationToast({
    mutationFn: (u: AdminUser) => systemService.adminSetActive(u.id, !u.is_active),
    success: (_d, u) => (u.is_active ? `${u.email} deactivated` : `${u.email} reactivated`),
    invalidate: [KEY],
    onSuccess: () => setTarget(null),
  })

  return (
    <div>
      <PageHeader title="Admin" description="Manage user accounts on this server." />
      <Card>
        <CardHeader title="Users" description={data ? `${data.length} account(s)` : undefined} />
        <CardBody className="p-0">
          {isPending && <LoadingState />}
          {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
          {data && data.length === 0 && <EmptyState title="No users" />}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">User accounts</caption>
                <thead className="bg-surface-2 text-xs text-subtle">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-medium">User</th>
                    <th scope="col" className="px-5 py-2 font-medium">Role</th>
                    <th scope="col" className="hidden px-5 py-2 font-medium md:table-cell">Created</th>
                    <th scope="col" className="hidden px-5 py-2 font-medium md:table-cell">Last login</th>
                    <th scope="col" className="px-5 py-2 font-medium">Status</th>
                    <th scope="col" className="px-5 py-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.map((u) => (
                    <tr key={u.id}>
                      <td className="px-5 py-3">
                        <span className="block font-medium text-fg">{u.full_name || '—'}</span>
                        <span className="block text-xs text-subtle">{u.email}</span>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={u.role === 'admin' ? 'primary' : 'neutral'}>{u.role}</Badge>
                      </td>
                      <td className="hidden px-5 py-3 text-subtle md:table-cell">{formatDate(u.created_at)}</td>
                      <td className="hidden px-5 py-3 text-subtle md:table-cell">{formatRelative(u.last_login_at)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={u.is_active ? 'success' : 'danger'}>{u.is_active ? 'Active' : 'Deactivated'}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {u.id !== me?.id && (
                          <Button variant={u.is_active ? 'outline' : 'secondary'} size="sm" onClick={() => setTarget(u)}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target?.is_active ? 'Deactivate user?' : 'Activate user?'}
        description={
          target?.is_active
            ? `${target.email} will be signed out everywhere and will not be able to sign in.`
            : `${target?.email ?? ''} will be able to sign in again.`
        }
        confirmLabel={target?.is_active ? 'Deactivate' : 'Activate'}
        destructive={!!target?.is_active}
        loading={toggle.isPending}
        onConfirm={() => target && toggle.mutate(target)}
      />
    </div>
  )
}
