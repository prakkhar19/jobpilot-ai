import * as RD from '@radix-ui/react-dialog'
import { CornerDownLeft, Moon, Search, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/auth'
import { useTheme } from '@/context/theme'
import { cn } from '@/utils/cn'
import { NAV_GROUPS } from './nav'

interface Command {
  id: string
  label: string
  group: string
  icon: LucideIcon
  run: () => void
}

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

/** ⌘K / Ctrl+K: jump to any page, search jobs, switch theme. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)
    const pages = NAV_GROUPS.flatMap((g) =>
      g.items
        .filter((i) => !i.adminOnly || user?.role === 'admin')
        .map((i) => ({ id: i.to, label: i.label, group: 'Go to', icon: i.icon, run: go(i.to) })),
    )
    const actions: Command[] = [
      { id: 'theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'Actions', icon: theme === 'dark' ? Sun : Moon, run: toggleTheme },
    ]
    return [...pages, ...actions]
  }, [navigate, user?.role, theme, toggleTheme])

  const term = q.trim().toLowerCase()
  const results = useMemo(() => {
    const matched = term ? commands.filter((c) => c.label.toLowerCase().includes(term)) : commands
    if (!term) return matched
    const search: Command = { id: 'search', label: `Search jobs for “${q.trim()}”`, group: 'Jobs', icon: Search, run: () => navigate(`/jobs?q=${encodeURIComponent(q.trim())}`) }
    return [search, ...matched]
  }, [commands, term, q, navigate])

  const close = (o: boolean) => {
    setOpen(o)
    if (!o) {
      setQ('')
      setActive(0)
    }
  }
  const choose = (c: Command | undefined) => {
    if (!c) return
    close(false)
    c.run()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-xs text-subtle transition-colors hover:border-border-strong hover:text-fg sm:inline-flex"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="w-28 text-left">Jump to…</span>
        <kbd className="rounded border border-border bg-surface-2 px-1.5 font-sans text-[10px] font-medium">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <RD.Root open={open} onOpenChange={close}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <RD.Content
            aria-describedby={undefined}
            className="animate-fade-up fixed top-[15vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl focus:outline-none"
          >
            <RD.Title className="sr-only">Command palette</RD.Title>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 text-subtle" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(results.length - 1, a + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(0, a - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    choose(results[active])
                  }
                }}
                placeholder="Type a page or search jobs…"
                aria-label="Command"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
                className="h-12 flex-1 bg-transparent text-sm text-fg placeholder:text-subtle focus:outline-none"
              />
              <kbd className="rounded border border-border bg-surface-2 px-1.5 text-[10px] text-subtle">Esc</kbd>
            </div>
            <ul id="command-list" role="listbox" aria-label="Commands" className="max-h-[50vh] overflow-y-auto p-2">
              {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-subtle">No matches.</li>}
              {results.map((c, i) => (
                <li
                  key={c.id}
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm',
                    i === active ? 'bg-primary-soft text-primary' : 'text-muted',
                  )}
                >
                  <c.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="text-[11px] text-subtle">{c.group}</span>
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </RD.Content>
        </RD.Portal>
      </RD.Root>
    </>
  )
}
