'use client'

import { useState, type CSSProperties } from 'react'
import { Activity, Gauge, Radar, Truck } from 'lucide-react'
import { FxScope } from '@/components/fx/use-fx'
import { FxToggle } from '@/components/fx/fx-toggle'
import { GlassPanel } from '@/components/fx/glass-panel'
import { GlowInput } from '@/components/fx/glow-input'
import { GradientText } from '@/components/fx/gradient-text'
import { HoloBackground } from '@/components/fx/holo-background'
import { MotionRoot } from '@/components/fx/motion-root'
import { NeonButton } from '@/components/fx/neon-button'
import { PageTransition } from '@/components/fx/page-transition'
import { Skeleton } from '@/components/fx/skeleton'
import { StatCard } from '@/components/fx/stat-card'
import type { FxLevel } from '@/components/fx/fx-core'

const LEVELS: { level: FxLevel; blurb: string }[] = [
  { level: 'full', blurb: 'Aurora, grid, scanline, particles, glow, blur, hover sheen + spotlight, count-up, entrances.' },
  { level: 'reduced', blurb: 'Static: no motion or canvas, no blur, half glow, denser glass. Focus rings and edges stay.' },
  { level: 'off', blurb: 'Flat: solid surfaces, no glow, no gradient edge, no banner. Brackets and focus rings stay.' },
]

// Mock series only (no real data on this page).
const SERIES = [
  { name: 'On time', color: 'var(--chart-1)', data: [42, 48, 45, 58, 64, 61, 72, 78, 74, 86, 91, 96] },
  { name: 'Delayed', color: 'var(--chart-2)', data: [20, 24, 30, 26, 33, 31, 38, 36, 41, 39, 44, 42] },
]

function MockChart() {
  const w = 560
  const h = 180
  const pad = { l: 34, r: 8, t: 8, b: 22 }
  const max = 100
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / 11
  const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Mock line chart: on time and delayed, 12 weeks" className="tabular w-full">
      {[0, 25, 50, 75, 100].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--brand-border)" strokeWidth="1" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--brand-text-muted)">{t}</text>
        </g>
      ))}
      {SERIES.map((s) => {
        const d = s.data.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
        return (
          <g key={s.name}>
            <path d={`${d} L${x(11)},${y(0)} L${x(0)},${y(0)} Z`} fill={s.color} opacity="0.08" />
            <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            <circle cx={x(11)} cy={y(s.data[11]!)} r="3.5" fill={s.color} />
          </g>
        )
      })}
      {[0, 3, 6, 9, 11].map((i) => (
        <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize="12" fill="var(--brand-text-muted)">W{i + 1}</text>
      ))}
    </svg>
  )
}

function Block({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-brand-text-muted">{title}</h3>
      {children}
    </section>
  )
}

function LevelDemo({ level, blurb }: { level: FxLevel; blurb: string }) {
  const [loading, setLoading] = useState(false)
  return (
    <FxScope level={level} className="relative isolate overflow-hidden rounded-2xl border border-brand-border">
      <HoloBackground variant="hero" contained />
      <div className="relative z-10 space-y-6 p-5 md:p-8">
        <header>
          <h2 className="font-display text-2xl font-semibold">
            data-fx = <GradientText>{level}</GradientText>
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-brand-text-muted">{blurb}</p>
        </header>

        <Block title="GlassPanel tones 1 / 2 / 3 / data (hover for spotlight + sheen)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([1, 2, 3, 'data'] as const).map((t) => (
              <GlassPanel key={t} tone={t} className="p-4">
                <p className="font-display font-semibold">Tone {t}</p>
                <p className="mt-1 text-sm text-brand-text-muted">Muted text on glass, 4.5:1+.</p>
              </GlassPanel>
            ))}
          </div>
        </Block>

        <div className="grid gap-6 lg:grid-cols-2">
          <Block title="NeonButton">
            <div className="flex flex-wrap items-center gap-4">
              <NeonButton>Sign in</NeonButton>
              <NeonButton loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600) }}>
                {loading ? 'Working…' : 'Click for loading'}
              </NeonButton>
              <NeonButton disabled>Disabled</NeonButton>
            </div>
          </Block>
          <Block title="GlowInput (focus it)">
            <div className="grid max-w-sm gap-3">
              <GlowInput aria-label="Demo username" placeholder="Username" />
              <GlowInput aria-label="Demo password" type="password" placeholder="Password" />
            </div>
          </Block>
        </div>

        <Block title="StatCard (count-up, tabular numerals, data glass)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard index={0} label="Active vehicles" value={1284} icon={<Truck />} delta={{ value: 4.2, label: 'vs last week' }} />
            <StatCard index={1} label="On-time rate" value={96.4} decimals={1} suffix="%" icon={<Gauge />} delta={{ value: 1.1, label: 'vs last week' }} />
            <StatCard index={2} label="Open alerts" value={37} icon={<Radar />} delta={{ value: -12.5, label: 'vs last week' }} />
            <StatCard index={3} label="Events / min" value={48210} icon={<Activity />} />
          </div>
        </Block>

        <div className="grid gap-3 lg:grid-cols-3">
          <GlassPanel tone="data" className="p-4 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display font-semibold">Mock chart panel</p>
              <div className="flex gap-4 text-xs text-brand-text-muted">
                {SERIES.map((s) => (
                  <span key={s.name} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
            <MockChart />
          </GlassPanel>
          <GlassPanel tone="data" className="space-y-3 p-4">
            <p className="font-display font-semibold">Skeleton</p>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24" />
          </GlassPanel>
        </div>
      </div>
    </FxScope>
  )
}

export function UiPreview() {
  const [run, setRun] = useState(0)
  return (
    <MotionRoot>
      <div className="min-h-screen bg-brand-primary p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-semibold">Holographic HUD: primitives</h1>
              <p className="mt-1 text-sm text-brand-text-muted">
                Dev-only. Each block is pinned to one fx level. The control on the right changes the page-level
                setting (used by the PageTransition demo below). The OS reduced-motion setting overrides motion everywhere.
              </p>
            </div>
            <FxToggle />
          </header>

          <GlassPanel tone="data" className="p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="font-display font-semibold">PageTransition (follows the page-level control)</p>
              <NeonButton onClick={() => setRun((n) => n + 1)}>Replay</NeonButton>
            </div>
            <PageTransition key={run} className="mt-3 text-sm text-brand-text-muted">
              Enter transition: opacity + translateY, 520ms, ease-out. Replay #{run}.
            </PageTransition>
          </GlassPanel>

          {LEVELS.map((l) => (
            <LevelDemo key={l.level} {...l} />
          ))}
        </div>
      </div>
    </MotionRoot>
  )
}
