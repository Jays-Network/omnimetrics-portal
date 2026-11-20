'use client'

import { m } from 'framer-motion'
import type { ReactNode } from 'react'
import { FX_EASE_OUT, FX_T } from './fx-tokens'
import { useFxLevel } from './use-fx'

/** Route enter transition (opacity + translateY). Plain wrapper unless level is "full". Needs <MotionRoot>. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const level = useFxLevel()
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
