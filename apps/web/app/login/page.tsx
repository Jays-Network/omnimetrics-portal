import { LoginExperience } from '@/components/login-experience'

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'OmniMetrics'

/** Only allow same-site redirects back into the guarded areas. */
function safeNext(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value
  if (
    candidate &&
    candidate.startsWith('/') &&
    !candidate.startsWith('//') &&
    !candidate.includes('\\') &&
    (candidate === '/dashboard' ||
      candidate.startsWith('/dashboard/') ||
      candidate.startsWith('/dashboard?') ||
      candidate === '/admin' ||
      candidate.startsWith('/admin/') ||
      candidate.startsWith('/admin?'))
  ) {
    return candidate
  }
  return '/dashboard'
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = safeNext(params.next)

  return <LoginExperience next={next} brand={BRAND_NAME} />
}
