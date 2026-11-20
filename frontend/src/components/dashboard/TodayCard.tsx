import { useQuery } from '@tanstack/react-query'
import { Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CountUp } from '@/components/ui'
import { applyQueueService } from '@/services/applyQueue'

/** Green hero card: how many applications went out today against a small daily goal. */
export function TodayCard() {
  const q = useQuery({ queryKey: ['apply-queue', 'summary'], queryFn: () => applyQueueService.list(1) })
  const today = q.data?.applied_today ?? 0
  const waiting = q.data?.total ?? 0
  const goal = Math.max(5, Math.min(10, today + waiting))
  const pct = Math.min(100, Math.round((today / goal) * 100))

  return (
    <Link
      to="/apply"
      className="glow-primary group relative isolate block overflow-hidden rounded-3xl bg-brand p-6 text-white focus-visible:outline-2 focus-visible:outline-ring"
    >
      {/* soft wave, like an activity chart */}
      <svg aria-hidden="true" viewBox="0 0 400 160" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 -z-10 h-2/3 w-full opacity-40">
        <path d="M0 120 C 60 60, 110 150, 170 95 S 280 40, 330 90 S 380 120, 400 70 L400 160 L0 160 Z" fill="rgb(255 255 255 / 0.18)" />
        <path d="M0 120 C 60 60, 110 150, 170 95 S 280 40, 330 90 S 380 120, 400 70" fill="none" stroke="rgb(255 255 255 / 0.7)" strokeWidth="2" />
      </svg>
      <div aria-hidden="true" className="absolute -top-16 -right-10 -z-10 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
      <p className="text-sm text-white/85">Applied today</p>
      <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
        <CountUp value={today} />
        <span className="ml-2 text-lg font-normal text-white/80">of {goal}</span>
      </p>
      <p className="mt-1 text-sm text-white/85">{pct}% of today's goal</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Daily goal">
        <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1.5 text-sm font-medium backdrop-blur">
        <Zap className="h-4 w-4" aria-hidden="true" />
        {waiting > 0 ? `${waiting} ready in Apply Mode` : 'Open Apply Mode'}
      </p>
    </Link>
  )
}
