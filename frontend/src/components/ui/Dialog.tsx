import * as RD from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export const DialogRoot = RD.Root
export const DialogTrigger = RD.Trigger
export const DialogClose = RD.Close

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <RD.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-xl border border-border bg-surface shadow-2xl focus:outline-none',
            { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size],
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RD.Title className="text-base font-semibold text-fg">{title}</RD.Title>
              {description && <RD.Description className="mt-1 text-sm text-subtle">{description}</RD.Description>}
            </div>
            <RD.Close
              className="-m-1 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}

interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  side?: 'left' | 'right'
  className?: string
  hideHeader?: boolean
}

export function Drawer({ open, onOpenChange, title, description, children, side = 'right', className, hideHeader }: DrawerProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RD.Content
          className={cn(
            'fixed inset-y-0 z-50 flex w-full flex-col border-border bg-surface shadow-2xl focus:outline-none',
            side === 'right' ? 'right-0 max-w-2xl border-l' : 'left-0 max-w-xs border-r',
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', hideHeader && 'sr-only')}>
            <div className="min-w-0">
              <RD.Title className="truncate text-base font-semibold text-fg">{title}</RD.Title>
              {description && <RD.Description className="mt-1 text-sm text-subtle">{description}</RD.Description>}
            </div>
            <RD.Close className="-m-1 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Close panel">
              <X className="h-4 w-4" aria-hidden="true" />
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
