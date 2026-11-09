import {
  Activity,
  BarChart3,
  Bookmark,
  Briefcase,
  CalendarClock,
  FileText,
  LayoutDashboard,
  Mail,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  adminOnly?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    label: 'Jobs',
    items: [
      { to: '/jobs', label: 'Discover Jobs', icon: Search, end: true },
      { to: '/jobs/recommended', label: 'Recommended', icon: Sparkles },
      { to: '/jobs/saved', label: 'Saved Jobs', icon: Bookmark },
    ],
  },
  {
    label: 'Documents',
    items: [
      { to: '/resumes', label: 'Resume Studio', icon: FileText },
      { to: '/cover-letters', label: 'Cover Letters', icon: Mail },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { to: '/applications', label: 'Applications', icon: Briefcase },
      { to: '/interviews', label: 'Interviews', icon: CalendarClock },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Automation',
    items: [
      { to: '/agent', label: 'Agent Activity', icon: Activity },
      { to: '/integrations', label: 'Integrations', icon: Plug },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/profile', label: 'Candidate Profile', icon: UserRound },
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/security', label: 'Security & Privacy', icon: ShieldCheck },
      { to: '/admin', label: 'Admin', icon: Users, adminOnly: true },
    ],
  },
]
