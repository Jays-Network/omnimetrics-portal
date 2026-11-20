'use client'

import { useEffect, useRef } from 'react'
import { FX_MAX_DPR, FX_MAX_PARTICLES } from './fx-tokens'

interface P { x: number; y: number; vx: number; vy: number; r: number; hue: 0 | 1 }

/**
 * Hand-rolled particle field. Limits: <= 60 particles, DPR <= 1.5, one rAF loop
 * that stops while the tab is hidden. Mounted only at fx level "full".
 */
export default function HoloCanvas({ count = 48 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const host = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !host || !ctx) return

    const css = getComputedStyle(document.documentElement)
    const c1 = css.getPropertyValue('--glow-1').trim() || '#6edbf9'
    const c2 = css.getPropertyValue('--glow-3').trim() || '#a564e9'
    const dpr = Math.min(window.devicePixelRatio || 1, FX_MAX_DPR)
    let w = 0
    let h = 0
    let parts: P[] = []
    let raf = 0
    let last = 0

    const seed = () => {
      const n = Math.min(count, FX_MAX_PARTICLES, Math.round((w * h) / 26000))
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 22,
        vy: (Math.random() - 0.5) * 22,
        r: 0.8 + Math.random() * 1.4,
        hue: Math.random() < 0.6 ? 0 : 1,
      }))
    }
    const resize = () => {
      w = host.clientWidth
      h = host.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    const LINK = 120
    const frame = (t: number) => {
      raf = 0
      if (document.hidden) return // resumed by visibilitychange
      const dt = Math.min((t - (last || t)) / 1000, 0.05)
      last = t
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.x < -10) p.x = w + 10
        else if (p.x > w + 10) p.x = -10
        if (p.y < -10) p.y = h + 10
        else if (p.y > h + 10) p.y = -10
      }
      ctx.lineWidth = 1
      ctx.strokeStyle = c1
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i]!
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j]!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 < LINK * LINK) {
            ctx.globalAlpha = (1 - Math.sqrt(d2) / LINK) * 0.28
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }
      ctx.globalAlpha = 0.75
      for (const p of parts) {
        ctx.fillStyle = p.hue ? c2 : c1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (!raf && !document.hidden) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }
    const onVis = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0)) : start())

    const ro = new ResizeObserver(resize)
    ro.observe(host)
    document.addEventListener('visibilitychange', onVis)
    resize()
    start()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [count])

  return <canvas ref={ref} className="absolute inset-0 size-full" />
}
