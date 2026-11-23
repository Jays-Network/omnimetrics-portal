import type { Metadata, Viewport } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { DM_Sans, Syne } from 'next/font/google'
import { Providers } from '@/components/providers'
import { FX_BOOT_SCRIPT } from '@/components/fx/fx-core'
import './globals.css'

const syne = Syne({ subsets: ['latin'], variable: '--font-syne', display: 'swap' })
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' })

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'OmniMetrics'
const BRAND_COLOR = process.env.NEXT_PUBLIC_BRAND_COLOR

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s | ${BRAND_NAME}` },
  description: `${BRAND_NAME} fleet tracking portal`,
  // Icons come from the file conventions in this folder: icon.png, apple-icon.png, favicon.ico.
}

// Keep in sync with --brand-primary in globals.css (browser chrome colour).
export const viewport: Viewport = {
  themeColor: '#0e182e',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // Per-client accent override from NEXT_PUBLIC_BRAND_COLOR (build time).
  const brandStyle = BRAND_COLOR
    ? ({ '--brand-accent': BRAND_COLOR } as CSSProperties)
    : undefined

  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} dark`} style={brandStyle} suppressHydrationWarning>
      <head>
        {/* Sets <html data-fx> before first paint (no flash). See components/fx/fx-core.ts. */}
        <script dangerouslySetInnerHTML={{ __html: FX_BOOT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
