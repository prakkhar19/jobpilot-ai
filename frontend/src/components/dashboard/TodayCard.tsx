import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CountUp } from '@/components/ui'
import { applyQueueService } from '@/services/applyQueue'

/** White highlight card: applications sent today against a small daily goal, with a lemon progress bar. */
export function TodayCard() {
  const q = useQuery({ queryKey: ['apply-queue', 'summary'], queryFn: () => applyQueueService.list(1) })
  const today = q.data?.applied_today ?? 0
  const waiting = q.data?.total ?? 0
  const goal = Math.max(5, Math.min(10, today + waiting))
  const pct = Math.min(100, Math.round((today / goal) * 100))

  return (
    <Link
      to="/apply"
      className="group relative isolate flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-white p-6 text-neutral-950 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.6)] ring-1 ring-black/5 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <svg aria-hidden="true" viewBox="0 0 400 160" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 -z-10 h-2/3 w-full">
        <path d="M0 120 C 60 60, 110 150, 170 95 S 280 40, 330 90 S 380 120, 400 70" fill="none" stroke="rgb(0 0 0 / 0.07)" strokeWidth="2" />
      </svg>
      <div>
        <p className="text-sm text-neutral-500">Applied today</p>
        <p className="mt-1 text-5xl font-light tracking-tight tabular-nums">
          <CountUp value={today} />
          <span className="ml-2 text-lg text-neutral-400">/ {goal}</span>
        </p>
        <p className="mt-1 text-sm text-neutral-500">{pct}% of today's goal</p>
      </div>
      <div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Daily goal">
          <div className="h-full rounded-full bg-lemon transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white">
          {waiting > 0 ? `${waiting} ready in Apply Mode` : 'Open Apply Mode'}
          <ArrowRight className="h-4 w-4 text-lemon transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </p>
      </div>
    </Link>
  )
}
