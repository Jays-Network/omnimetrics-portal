'use client'

import { useState, type CSSProperties } from 'react'
import Image from 'next/image'
import { GlassPanel } from '@/components/fx/glass-panel'
import { GradientText } from '@/components/fx/gradient-text'
import { HoloBackground } from '@/components/fx/holo-background'
import { useFxLevel } from '@/components/fx/use-fx'
import { LoginForm } from '@/components/login-form'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const stagger = (i: number) => ({ '--i': i }) as CSSProperties

/** Login screen: holographic background, orbiting emblem, glass card, success warp. */
export function LoginExperience({ next, brand }: { next: string; brand: string }) {
  const level = useFxLevel()
  const [leaving, setLeaving] = useState(false)

  // Runs after a successful sign-in, before the (unchanged) redirect in LoginForm.
  async function onSuccess() {
    setLeaving(true)
    if (level === 'full') await delay(650)
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <HoloBackground variant="hero" />
      {leaving && level === 'full' ? <div aria-hidden className="fx-warp" /> : null}
      <div className="fx-stage relative z-10 w-full max-w-sm" data-leaving={leaving || undefined}>
        <div className="mb-7 text-center">
          <div className="fx-rise relative mx-auto size-44" style={stagger(0)}>
            <div aria-hidden className="fx-halo-pulse" />
            <svg aria-hidden viewBox="0 0 100 100" fill="none" className="fx-orbit">
              <circle cx="50" cy="50" r="48" strokeWidth="0.5" strokeDasharray="0.8 2.4 10 2.4" style={{ stroke: 'var(--glow-1)' }} />
              <circle cx="50" cy="2" r="1.7" style={{ fill: 'var(--glow-1)' }} />
              <circle cx="98" cy="50" r="1.1" style={{ fill: 'var(--glow-3)' }} />
            </svg>
            <svg aria-hidden viewBox="0 0 100 100" fill="none" className="fx-orbit" data-rev="">
              <circle cx="50" cy="50" r="48" strokeWidth="0.35" strokeDasharray="4 6" style={{ stroke: 'var(--glow-3)' }} />
              <circle cx="50" cy="98" r="1.4" style={{ fill: 'var(--glow-3)' }} />
            </svg>
            <Image
              src="/brand/emblem-1024.png"
              alt=""
              width={176}
              height={176}
              priority
              sizes="176px"
              className="relative size-full drop-shadow-[0_0_18px_var(--glow-1-mid)]"
            />
          </div>
          <h1 className="fx-rise mt-5 font-display text-4xl font-semibold tracking-tight" style={stagger(1)}>
            <span className="sr-only">Sign in to </span>
            <GradientText>{brand}</GradientText>
          </h1>
          <p className="fx-rise mt-2 text-sm text-brand-text-muted" style={stagger(2)}>
            Sign in to your account
          </p>
        </div>
        <GlassPanel tone={2} className="fx-rise" style={stagger(3)}>
          <LoginForm next={next} onSuccess={onSuccess} />
        </GlassPanel>
      </div>
    </main>
  )
}
