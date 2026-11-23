'use client'

import { Fragment, type ReactNode } from 'react'
import type { PanelProps } from '@/lib/panels/types'
import { NoData } from './frame'

/** Only http(s), mailto and same-site paths are linkable; anything else renders as plain text. */
export function safeHref(href: string): string | null {
  if (href.startsWith('/') && !href.startsWith('//')) return href
  try {
    const u = new URL(href)
    return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2]) out.push(<strong key={k++}>{m[2]}</strong>)
    else if (m[3]) out.push(<em key={k++}>{m[3]}</em>)
    else {
      const href = safeHref(m[5]!)
      out.push(href ? <a key={k++} href={href} rel="noopener noreferrer" className="text-brand-accent underline underline-offset-2">{m[4]}</a> : m[4])
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Tiny Markdown subset (headings, bold, italic, links, bullet lists). Output is React elements, never raw HTML. */
export function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/)
  return (
    <div className="h-full min-h-0 space-y-2 overflow-y-auto break-words text-sm">
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (lines.every((l) => /^[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          )
        }
        const h = /^(#{1,3}) (.*)$/.exec(b)
        if (h) {
          const cls = h[1]!.length === 1 ? 'text-lg' : 'text-base'
          return <p key={i} role="heading" aria-level={h[1]!.length + 1} className={`font-display font-semibold ${cls}`}>{inline(h[2]!)}</p>
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

export function TextPanel({ data }: PanelProps) {
  if (data.kind !== 'text') return <NoData kind="text" />
  return <Markdown source={data.markdown} />
}

export function ImagePanel({ data }: PanelProps) {
  if (data.kind !== 'image') return <NoData kind="image" />
  // Only same-origin paths: no outside network calls from a panel.
  const src = data.src.startsWith('/') && !data.src.startsWith('//') ? data.src : null
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={data.alt} className="mx-auto h-full max-h-full max-w-full object-contain" /> : <NoData kind="same-origin image" />
}

export function DividerPanel({ data }: PanelProps) {
  if (data.kind !== 'divider') return <NoData kind="divider" />
  return (
    <div className="flex h-full items-center gap-3">
      <h2 className="font-display text-base font-semibold">{data.title}</h2>
      <span aria-hidden className="h-px flex-1 bg-brand-border-strong" />
    </div>
  )
}

export function LinksPanel({ data }: PanelProps) {
  if (data.kind !== 'links') return <NoData kind="links" />
  return (
    <ul className="m-0 h-full min-h-0 list-none space-y-1 overflow-y-auto break-words p-0 text-sm">
      {data.items.map((i) => {
        const href = safeHref(i.href)
        return (
          <li key={i.label} className="list-none">
            {href ? (
              <a href={href} rel="noopener noreferrer" className="text-brand-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
                {i.label}
              </a>
            ) : (
              i.label
            )}
          </li>
        )
      })}
    </ul>
  )
}
