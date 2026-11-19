import type { Metadata } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { DM_Sans, Syne } from 'next/font/google'
import { Providers } from '@/components/providers'
import './globals.css'

const syne = Syne({ subsets: ['latin'], variable: '--font-syne', display: 'swap' })
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' })

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'OmniMetrics'
const BRAND_COLOR = process.env.NEXT_PUBLIC_BRAND_COLOR

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: `${BRAND_NAME} fleet tracking portal`,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // Per-client accent override from NEXT_PUBLIC_BRAND_COLOR (build time).
  const brandStyle = BRAND_COLOR
    ? ({ '--brand-accent': BRAND_COLOR } as CSSProperties)
    : undefined

  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} dark`} style={brandStyle} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
