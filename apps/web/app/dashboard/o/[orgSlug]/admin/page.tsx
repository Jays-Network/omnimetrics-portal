import { redirect } from 'next/navigation'
import { orgBase } from '@/components/shell/nav'
import { requireOrgPage } from '@/lib/portal/org'

export default async function AdminIndex({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await requireOrgPage(orgSlug, 'admin.view')
  redirect(`${orgBase(orgSlug)}/admin/users`)
}
