import { LoginForm } from '@/components/login-form'

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

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-primary px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(60rem 40rem at 50% -10%, var(--brand-accent), transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-text">
            {BRAND_NAME}
          </h1>
          <p className="mt-2 text-sm text-brand-text-muted">Sign in to your account</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  )
}
