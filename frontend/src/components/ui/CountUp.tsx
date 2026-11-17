import { useCountUp } from '@/hooks/useCountUp'
import { formatNumber } from '@/utils/format'

export function CountUp({ value, format = (n) => formatNumber(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const v = useCountUp(value)
  return <>{format(v)}</>
}
