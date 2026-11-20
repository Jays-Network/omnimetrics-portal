import { redirect } from 'next/navigation'
import { orgBase } from '@/components/shell/nav'
import { requireOrgPage } from '@/lib/portal/org'

export default async function OrgIndex({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await requireOrgPage(orgSlug)
  redirect(`${orgBase(orgSlug)}/dashboards`)
}
