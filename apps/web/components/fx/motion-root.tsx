'use client'

import { LazyMotion, domAnimation } from 'framer-motion'
import type { ReactNode } from 'react'

// domAnimation only (no layout/drag). Mounted by the dashboard layout and /dev/ui,
// never on /login, so the sign-in route does not ship framer-motion.
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  )
}
