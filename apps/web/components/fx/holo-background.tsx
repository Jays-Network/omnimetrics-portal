'use client'

import dynamic from 'next/dynamic'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { useFxLevel } from './use-fx'

// Canvas code is a separate chunk, fetched only when the level is "full".
const HoloCanvas = dynamic(() => import('./holo-canvas'), { ssr: false })

export interface HoloBackgroundProps {
  /** hero = login (banner, 56 particles); app = shell (no banner, calmer, 28). */
  variant?: 'hero' | 'app'
  /** Fill the nearest positioned parent instead of the viewport (used by /dev/ui). */
  contained?: boolean
  className?: string
}

/**
 * Animated aurora + moving grid + scanline + capped particles + masked neural
 * banner. Everything reads the fx variables; off = flat navy, reduced = static.
 * Put page content in a `relative z-10` wrapper above it.
 */
export function HoloBackground({ variant = 'hero', contained = false, className }: HoloBackgroundProps) {
  const level = useFxLevel()
  const hero = variant === 'hero'
  return (
    <div
      aria-hidden
      className={cn('fx-holo z-0', contained ? 'absolute inset-0' : 'fixed inset-0', className)}
    >
      {level !== 'off' && hero ? (
        <Image
          src="/brand/login-bg.webp"
          alt=""
          width={1920}
          height={1157}
          sizes="100vw"
          fetchPriority="low"
          unoptimized
          className="fx-banner"
        />
      ) : null}
      <div className="fx-aurora" style={hero ? undefined : { opacity: 'calc(0.6 * var(--fx-ambient))' }}>
        <i />
        <i />
        <i />
      </div>
      <div className="fx-grid" />
      {level === 'full' ? <div className="fx-scan" /> : null}
      {level === 'full' ? <HoloCanvas count={hero ? 56 : 28} /> : null}
      <div className="fx-vignette" />
    </div>
  )
}
