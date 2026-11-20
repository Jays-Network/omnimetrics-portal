import Link from 'next/link'
import { GlassPanel } from '@/components/fx/glass-panel'

// Also used for "no access": same page, so existence of an organisation or section is never confirmed.
export default function DashboardNotFound() {
  return (
    <GlassPanel tone="data" className="max-w-md p-6">
      <h1 className="font-display text-xl font-semibold">Not found</h1>
      <p className="mt-1.5 text-sm text-brand-text-muted">This page does not exist, or you do not have access to it.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm text-brand-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
        Back to dashboards
      </Link>
    </GlassPanel>
  )
}
