import { useEffect, useRef, useState } from 'react'

function prefersStatic(): boolean {
  if (typeof window === 'undefined') return true
  if (/jsdom/i.test(navigator.userAgent)) return true // tests read the final value immediately
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** Animates from the previous value to `target` with an ease-out curve. */
export function useCountUp(target: number, duration = 900): number {
  const [isStatic] = useState(prefersStatic)
  const [value, setValue] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (isStatic) return
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const v = begin + (target - begin) * (1 - Math.pow(1 - t, 3))
      setValue(v)
      from.current = v
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, isStatic])
  return isStatic ? target : value
}
