/** Tiny dependency-free confetti burst. Does nothing when the user prefers reduced motion. */
export function confetti({ pieces = 140, duration = 2600 }: { pieces?: number; duration?: number } = {}): void {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '100' })
  const dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  document.body.appendChild(canvas)
  ctx.scale(dpr, dpr)
  const colors = ['#6366f1', '#ec4899', '#0ea5e9', '#22c55e', '#f59e0b']
  const w = window.innerWidth
  const parts = Array.from({ length: pieces }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: window.innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    size: 5 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }))
  const start = performance.now()
  const frame = (now: number) => {
    const t = now - start
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = Math.max(0, 1 - t / duration)
    for (const p of parts) {
      p.vy += 0.35
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      ctx.restore()
    }
    if (t < duration) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}
