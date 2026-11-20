import * as RT from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'
import { cn } from '@/utils/cn'

export const Tabs = RT.Root

export function TabsList({ className, ...rest }: ComponentProps<typeof RT.List>) {
  return (
    <RT.List
      className={cn('inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-border bg-surface-2/70 p-1', className)}
      {...rest}
    />
  )
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof RT.Trigger>) {
  return (
    <RT.Trigger
      className={cn(
        'rounded-full px-4 py-1.5 text-sm font-medium text-muted transition-all hover:text-fg',
        'data-[state=active]:bg-border-strong/70 data-[state=active]:text-fg data-[state=active]:shadow-sm',
        className,
      )}
      {...rest}
    />
  )
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof RT.Content>) {
  return <RT.Content className={cn('mt-4 focus-visible:outline-none', className)} {...rest} />
}
