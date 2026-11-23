'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { GlassPanel } from '@/components/fx/glass-panel'
import { cn } from '@/lib/utils'

// Small shared pieces for the M4 screens. Tokens only; effects follow data-fx through GlassPanel.
export const inputCls = 'h-9 w-full rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60'
export const btnCls = 'inline-flex items-center gap-1.5 rounded-md border border-brand-border-strong px-2.5 py-1.5 text-sm hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-50'
export const primaryCls = cn(btnCls, 'bg-brand-accent text-brand-accent-fg hover:bg-brand-accent')
export const dangerCls = cn(btnCls, 'text-brand-danger')
export const SCROLL = 'min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scroll-token'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }
/** JSON call. Non-2xx returns the server's generic error text; nothing else is read from the body. */
export async function api<T = Record<string, unknown>>(url: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return res.ok ? { ok: true, data: json as T } : { ok: false, status: res.status, error: typeof json.error === 'string' ? json.error : 'Request failed.' }
  } catch {
    return { ok: false, status: 0, error: 'Network error.' }
  }
}

export function MockBanner({ children }: { children?: ReactNode }) {
  return (
    <p role="note" className="mb-2 shrink-0 rounded-md border border-[var(--chart-2)] px-3 py-1.5 text-xs text-[var(--chart-2)]">
      {children ?? 'Mock: nothing is stored or sent. Do not enter real credentials.'}
    </p>
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'bad' | 'muted' | 'info'; children: ReactNode }) {
  const c = { ok: 'border-brand-accent text-brand-accent', bad: 'border-brand-danger text-brand-danger', muted: 'border-brand-border-strong text-brand-text-muted', info: 'border-brand-border-strong text-brand-text' }[tone]
  return <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize', c)}>{children}</span>
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs font-medium">{label}</label>
      {children}
      {hint ? <p id={`${id}-hint`} className="mt-0.5 text-xs text-brand-text-muted">{hint}</p> : null}
    </div>
  )
}

export function Status({ msg }: { msg: { text: string; error?: boolean } | null }) {
  return <p className={cn('min-h-4 text-xs', msg?.error ? 'text-brand-danger' : 'text-brand-text-muted')} role={msg?.error ? 'alert' : 'status'} aria-live="polite">{msg?.text ?? ''}</p>
}

/** Table card that scrolls inside itself (never the page). */
export function DataTable({ caption, head, children, className }: { caption: string; head: string[]; children: ReactNode; className?: string }) {
  return (
    <GlassPanel tone="data" className={cn('shrink-0 overflow-hidden', className)}>
      <div className={cn(SCROLL, 'overflow-x-auto')} data-scroll="table" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-brand-surface-raised text-left text-xs uppercase tracking-wider text-brand-text-muted">
            <tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </GlassPanel>
  )
}

/** Right-hand drawer: dialog semantics, Esc closes, focus moves in and returns, scrolls inside itself. */
export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const back = useRef<Element | null>(null)
  useEffect(() => {
    back.current = document.activeElement
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus()
    return () => { (back.current as HTMLElement | null)?.focus?.() }
  }, [])
  const key = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !ref.current) return
    const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
    if (f.length === 0) return
    const first = f[0]!, last = f[f.length - 1]!
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 bg-black/50" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} onKeyDown={key} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col">
        <GlassPanel tone={3} spotlight={false} sheen={false} className="fx-fill m-2 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-brand-border px-4 py-2.5">
              <h2 className="font-display text-base font-semibold">{title}</h2>
              <button type="button" data-close aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"><X className="size-4" aria-hidden /></button>
            </div>
            <div data-scroll="drawer" className={cn(SCROLL, 'flex-1 space-y-3 p-4')}>{children}</div>
            {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-brand-border px-4 py-2.5">{footer}</div> : null}
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}

/** Fixed-height page body: title row on top, content below scrolls on its own (no page scroll). */
export function PageFrame({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div data-page-frame className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold leading-tight">{title}</h1>
          {description ? <p className="text-sm text-brand-text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div data-scroll="page" className={cn(SCROLL, 'flex flex-1 flex-col gap-3 pr-1')}>{children}</div>
    </div>
  )
}

export function useBusy() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>) => { setBusy(true); try { return await fn() } finally { setBusy(false) } }, [])
  return [busy, run] as const
}
