import { ChevronDown, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui'
import { useAuth } from '@/context/auth'
import { errorMessage } from '@/services/api'

export function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const initials = (user?.full_name || user?.email || '?')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  const doLogout = async () => {
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (err) {
      toast.error('Logout failed', { description: errorMessage(err) })
    }
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-surface-2"
          aria-label="Open user menu"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials}
          </span>
          <span className="hidden max-w-[10rem] truncate text-muted sm:inline">{user?.full_name || user?.email}</span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-subtle sm:inline" aria-hidden="true" />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block truncate font-medium text-fg">{user?.full_name || 'Signed in'}</span>
          <span className="block truncate">{user?.email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/profile')}>
          <UserRound className="h-4 w-4" aria-hidden="true" /> Candidate profile
        </MenuItem>
        <MenuItem onSelect={() => navigate('/settings')}>
          <Settings className="h-4 w-4" aria-hidden="true" /> Settings
        </MenuItem>
        <MenuItem onSelect={() => navigate('/security')}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Security & privacy
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => void doLogout()}>
          <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
