import { cn } from '@/utils/cn'
import type { Tone } from '@/utils/constants'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm'

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    {
      'bg-primary text-primary-fg shadow-sm hover:opacity-90': variant === 'primary',
      'bg-surface-2 text-fg hover:bg-border': variant === 'secondary',
      'border border-border-strong bg-surface text-fg hover:bg-surface-2': variant === 'outline',
      'text-muted hover:bg-surface-2 hover:text-fg': variant === 'ghost',
      'bg-danger text-white shadow-sm hover:opacity-90 dark:text-bg': variant === 'danger',
    },
    {
      'h-8 px-3 text-xs': size === 'sm',
      'h-9 px-4 text-sm': size === 'md',
      'h-9 w-9 text-sm': size === 'icon',
      'h-8 w-8 text-xs': size === 'icon-sm',
    },
    extra,
  )
}

export const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted ring-border',
  primary: 'bg-primary-soft text-primary ring-primary/20',
  success: 'bg-success-soft text-success ring-success/20',
  warning: 'bg-warning-soft text-warning ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  info: 'bg-info-soft text-info ring-info/20',
}

export const toneBar: Record<Tone, string> = {
  neutral: 'bg-subtle',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
}

export const inputClasses =
  'block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle ' +
  'shadow-xs focus:border-ring focus:outline-2 focus:outline-offset-0 focus:outline-ring/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger'
