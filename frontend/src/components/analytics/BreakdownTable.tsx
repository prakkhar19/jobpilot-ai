import type { BreakdownRow } from '@/types/api'
import { formatPercent } from '@/utils/format'

export function BreakdownTable({ rows, keyLabel, caption }: { rows: BreakdownRow[]; keyLabel: string; caption: string }) {
  if (!rows.length) return <p className="px-5 py-6 text-sm text-subtle">No applications yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-subtle">
            <th scope="col" className="px-5 py-2 font-medium">{keyLabel}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Applications</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Submitted</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Responses</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Interviews</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Offers</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Response rate</th>
            <th scope="col" className="px-5 py-2 text-right font-medium">Interview rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="max-w-[16rem] truncate px-5 py-2 text-left font-medium text-fg">{r.key}</th>
              <td className="px-3 py-2 text-right text-muted">{r.applications}</td>
              <td className="px-3 py-2 text-right text-muted">{r.submitted}</td>
              <td className="px-3 py-2 text-right text-muted">{r.responses}</td>
              <td className="px-3 py-2 text-right text-muted">{r.interviews}</td>
              <td className="px-3 py-2 text-right text-muted">{r.offers}</td>
              <td className="px-3 py-2 text-right text-fg">{formatPercent(r.response_rate)}</td>
              <td className="px-5 py-2 text-right text-fg">{formatPercent(r.interview_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
