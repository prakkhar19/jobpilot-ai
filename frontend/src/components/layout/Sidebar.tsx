import { NavLink } from 'react-router-dom'
import { useAuth } from '@/context/auth'
import { cn } from '@/utils/cn'
import { Logo } from './Logo'
import { NAV_GROUPS } from './nav'

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.adminOnly || isAdmin)
        if (!items.length) return null
        return (
          <div key={group.label}>
            <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">{group.label}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-primary-soft text-primary before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-1 before:rounded-r-full before:bg-brand'
                          : 'text-muted hover:translate-x-0.5 hover:bg-surface-2 hover:text-fg',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col glass border-r border-border lg:flex">
      <div className="flex h-14 items-center border-b border-border px-5">
        <Logo />
      </div>
      <SidebarNav />
    </aside>
  )
}
