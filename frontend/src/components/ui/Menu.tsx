import * as DM from '@radix-ui/react-dropdown-menu'
import type { ComponentProps } from 'react'
import { cn } from '@/utils/cn'

export const Menu = DM.Root
export const MenuTrigger = DM.Trigger

export function MenuContent({ className, align = 'end', sideOffset = 6, ...rest }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg',
          className,
        )}
        {...rest}
      />
    </DM.Portal>
  )
}

export function MenuItem({ className, ...rest }: ComponentProps<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg outline-none select-none',
        'data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...rest}
    />
  )
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />
}

export function MenuLabel({ className, ...rest }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn('px-2.5 py-1.5 text-xs text-subtle', className)} {...rest} />
}
