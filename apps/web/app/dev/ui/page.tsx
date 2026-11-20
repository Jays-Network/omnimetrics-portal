import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { UiPreview } from './preview'

export const metadata: Metadata = { title: 'UI preview (dev)', robots: { index: false } }
export const dynamic = 'force-dynamic'

// Development-only review page for the fx primitives. 404 in production builds.
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <UiPreview />
}
