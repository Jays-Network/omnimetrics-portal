import type { ReactNode } from 'react'
import { PageTransition } from '@/components/fx/page-transition'

// A template remounts on every navigation, which replays the enter transition.
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>
}
