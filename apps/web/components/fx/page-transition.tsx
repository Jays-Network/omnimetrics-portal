'use client'

import { m } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FX_EASE_OUT, FX_T } from './fx-tokens'
import { useFxLevel } from './use-fx'

/**
 * Route enter transition (opacity + translateY). Plain wrapper unless level is "full". Needs <MotionRoot>.
 * It sits between the shell <main> and every page, so by default it passes the height down (h-full min-h-0):
 * a fixed-viewport page such as the editor depends on this link. Pages that scroll normally are unaffected.
 */
export const PAGE_FILL = 'h-full min-h-0'

export function PageTransition({ children, className: extra }: { children: ReactNode; className?: string }) {
  const level = useFxLevel()
  const className = cn(PAGE_FILL, extra)
  if (level !== 'full') return <div className={className}>{children}</div>
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: FX_T.slow, ease: FX_EASE_OUT }}
    >
      {children}
    </m.div>
  )
}
