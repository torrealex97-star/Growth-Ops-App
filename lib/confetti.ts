// Confeti ligero sin dependencias: pinta un canvas a pantalla completa, lanza una
// ráfaga de partículas y se autolimpia. Respeta prefers-reduced-motion.
export function fireConfetti(opts?: { particleCount?: number }) {
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const count = opts?.particleCount ?? 130
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }

  const dpr = window.devicePixelRatio || 1
  const resize = () => {
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()

  const W = window.innerWidth
  const H = window.innerHeight
  const colors = ['#3b82f6', '#60a5fa', '#22d3ee', '#10b981', '#f59e0b', '#f472b6', '#a78bfa']
  type P = {
    x: number
    y: number
    vx: number
    vy: number
    size: number
    color: string
    rot: number
    vrot: number
    shape: number
  }

  // Dos focos de lanzamiento (esquinas inferiores) hacia el centro-arriba.
  const parts: P[] = []
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9
    const speed = 9 + Math.random() * 9
    parts.push({
      x: fromLeft ? W * 0.15 : W * 0.85,
      y: H * 0.85,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
      shape: (Math.random() * 2) | 0,
    })
  }

  const gravity = 0.28
  const drag = 0.992
  let frame = 0
  const maxFrames = 200

  const tick = () => {
    ctx.clearRect(0, 0, W, H)
    let alive = false
    for (const p of parts) {
      p.vx *= drag
      p.vy = p.vy * drag + gravity
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vrot
      const opacity = Math.max(0, 1 - frame / maxFrames)
      if (p.y < H + 40 && opacity > 0) alive = true
      ctx.save()
      ctx.globalAlpha = opacity
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      if (p.shape === 0) ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      else {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    frame++
    if (alive && frame < maxFrames) {
      requestAnimationFrame(tick)
    } else {
      canvas.remove()
    }
  }
  requestAnimationFrame(tick)
}

// Frase de ánimo aleatoria, personalizada con el nombre de la persona.
const CHEERS = [
  (n: string) => `¡Bien hecho, ${n}! Cada call cuenta 💪`,
  (n: string) => `¡Guardado, ${n}! A por la siguiente 🚀`,
  (n: string) => `¡Genial, ${n}! Así se cierra 🔥`,
  (n: string) => `¡Toma, ${n}! Un pasito más cerca del objetivo 🎯`,
  (n: string) => `¡Crack, ${n}! Sigue con esa energía ⚡`,
  (n: string) => `¡Perfecto, ${n}! Tu constancia se nota 🌟`,
]

export function cheerMessage(name?: string | null): string {
  const first = (name || '').trim().split(' ')[0] || 'crack'
  return CHEERS[(Math.random() * CHEERS.length) | 0](first)
}
