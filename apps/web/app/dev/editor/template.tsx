import type { ReactNode } from 'react'
import { PageTransition } from '@/components/fx/page-transition'

export default function DevEditorTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>
}
