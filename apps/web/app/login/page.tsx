import Image from 'next/image'
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
      {/* Decorative background. Static, non-blocking (lazy, low fetch priority); the
          navy page colour is already painted, so nothing shifts when it arrives. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Image
          src="/brand/login-bg.webp"
          alt=""
          fill
          sizes="100vw"
          fetchPriority="low"
          unoptimized
          className="object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-brand-primary/75" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background:
              'radial-gradient(60rem 40rem at 50% -10%, var(--brand-accent), transparent 60%)',
          }}
        />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="sr-only">Sign in to {BRAND_NAME}</h1>
          <Image
            src="/brand/logo-horizontal.png"
            alt={BRAND_NAME}
            width={1400}
            height={617}
            priority
            sizes="(max-width: 384px) 100vw, 384px"
            className="mx-auto h-auto w-full max-w-xs"
          />
          <p className="mt-4 text-sm text-brand-text-muted">Sign in to your account</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  )
}
