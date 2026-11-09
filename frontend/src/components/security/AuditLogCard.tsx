import { useQuery } from '@tanstack/react-query'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { authService } from '@/services/auth'
import { formatDate, humanize } from '@/utils/format'

export function AuditLogCard() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => authService.auditLog(100),
  })
  return (
    <Card>
      <CardHeader title="Audit log" description="Security-relevant actions on your account (latest 100)." />
      <CardBody className="p-0">
        {isPending && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && data.length === 0 && <EmptyState title="No audit events yet" />}
        {data && data.length > 0 && (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Audit log entries</caption>
              <thead className="sticky top-0 bg-surface-2 text-xs text-subtle">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium">When</th>
                  <th scope="col" className="px-5 py-2 font-medium">Action</th>
                  <th scope="col" className="hidden px-5 py-2 font-medium sm:table-cell">Target</th>
                  <th scope="col" className="hidden px-5 py-2 font-medium md:table-cell">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2 whitespace-nowrap text-subtle">{formatDate(e.created_at, true)}</td>
                    <td className="px-5 py-2 text-fg">
                      <code className="font-mono text-xs">{e.action}</code>
                    </td>
                    <td className="hidden px-5 py-2 text-subtle sm:table-cell">{e.target_type ? humanize(e.target_type) : '—'}</td>
                    <td className="hidden px-5 py-2 text-subtle md:table-cell">{e.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
