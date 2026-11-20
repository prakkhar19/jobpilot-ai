import { Briefcase, LayoutDashboard, Sparkles, UserRound, Zap } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/utils/cn'

const TABS = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/jobs/recommended', label: 'Jobs', icon: Sparkles },
  { to: '/apply', label: 'Apply', icon: Zap },
  { to: '/applications', label: 'Applied', icon: Briefcase },
  { to: '/profile', label: 'Profile', icon: UserRound },
]

/** Floating tab bar for phones (the sidebar takes over on large screens). */
export function MobileTabBar() {
  return (
    <nav
      aria-label="Quick navigation"
      className="card-surface fixed inset-x-3 bottom-3 z-40 bg-surface/90 backdrop-blur-xl rounded-3xl border border-border pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5 gap-1 p-1.5">
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'bg-[radial-gradient(circle_at_50%_0%,var(--glow),transparent_70%)] bg-surface-2/70 text-fg'
                    : 'text-subtle hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <t.icon className={cn('h-5 w-5', isActive && 'text-primary')} aria-hidden="true" />
                  {t.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
