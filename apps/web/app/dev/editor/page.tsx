import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LazyBuilder } from '@/components/builder/builder-loader'
import { addPanel, appendVersion, emptyDash } from '@/lib/builder/model'

export const metadata: Metadata = { title: 'Editor layout (dev)', robots: { index: false } }
export const dynamic = 'force-dynamic'

// Development-only builder on mock data, used by e2e/editor-layout.spec.ts. 404 in production builds.
export default function DevEditorPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  let d = emptyDash()
  for (const [t, id, x, y] of [['stat', 'seed-1', 24, 24], ['stat-spark', 'seed-2', 528, 24], ['bar-grouped', 'seed-3', 24, 348], ['table', 'seed-4', 24, 772]] as const) d = addPanel(d, t, id, { x, y })
  const versions = appendVersion([], d, 'dev', 'Dev layout fixture', new Date('2026-11-01T08:00:00Z'))
  return <LazyBuilder orgSlug="dev" nodeId="layout" orgName="Dev" dashboardName="Layout fixture" initialVersions={versions} showTerminal isAdmin canDelete />
}
