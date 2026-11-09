import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Spinner } from '@/components/ui'
import { errorMessage } from '@/services/api'
import { notificationService } from '@/services/agent'
import type { Notification } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatRelative } from '@/utils/format'

const NOTIFICATIONS_KEY = ['notifications'] as const

export function NotificationsBell() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isPending, isError, error } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => notificationService.list({ limit: 20 }),
    refetchInterval: 60_000,
  })
  const unread = data?.unread ?? 0

  const refresh = () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })

  const open = async (n: Notification) => {
    try {
      if (!n.read_at) await notificationService.markRead(n.id)
      void refresh()
    } catch (err) {
      toast.error('Could not mark notification as read', { description: errorMessage(err) })
    }
    if (n.link && n.link.startsWith('/')) navigate(n.link)
  }

  const readAll = async () => {
    try {
      await notificationService.markAllRead()
      void refresh()
      toast.success('All notifications marked as read')
    } catch (err) {
      toast.error('Could not update notifications', { description: errorMessage(err) })
    }
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white dark:text-bg">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </MenuTrigger>
      <MenuContent className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <MenuLabel className="px-0 text-sm font-semibold text-fg">Notifications</MenuLabel>
          {unread > 0 && (
            <button
              type="button"
              onClick={readAll}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary-soft"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
            </button>
          )}
        </div>
        <MenuSeparator />
        <div className="max-h-96 overflow-y-auto p-1">
          {isPending && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          {isError && <p className="px-3 py-6 text-center text-sm text-danger">{errorMessage(error)}</p>}
          {data && data.items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-subtle">You're all caught up.</p>
          )}
          {data?.items.map((n) => (
            <MenuItem key={n.id} onSelect={() => void open(n)} className="items-start py-2">
              <span
                className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary')}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', n.read_at ? 'text-muted' : 'font-medium text-fg')}>
                  {n.title}
                  {!n.read_at && <span className="sr-only"> (unread)</span>}
                </span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-subtle">{n.body}</span>}
                <span className="mt-0.5 block text-[11px] text-subtle">{formatRelative(n.created_at)}</span>
              </span>
            </MenuItem>
          ))}
        </div>
      </MenuContent>
    </Menu>
  )
}
