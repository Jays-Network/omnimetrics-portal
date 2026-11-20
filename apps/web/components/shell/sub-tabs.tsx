'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface SubTab {
  label: string
  href: string
}

/** Horizontal second-level tabs inside a section (Admin). Active = longest matching href. */
export function SubTabs({ tabs, label }: { tabs: SubTab[]; label: string }) {
  const pathname = usePathname()
  const active = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return (
    <nav aria-label={label} className="mb-3">
      <ul className="flex flex-wrap gap-1 border-b border-brand-border/60">
        {tabs.map((t) => {
          const on = t === active
          return (
            <li key={t.href} className="list-none">
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-9 items-center border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                  on
                    ? 'border-brand-accent font-medium text-brand-text'
                    : 'border-transparent text-brand-text-muted hover:text-brand-text',
                )}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
