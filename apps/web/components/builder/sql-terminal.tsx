'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Play } from 'lucide-react'
import { GlassPanel } from '@/components/fx/glass-panel'
import { ROW_CAP, runMock, type RunOutcome } from '@/lib/builder/terminal'

export const OPEN_KEY = 'omni.sqlTerminal.open'

/**
 * Director-only SQL terminal (R7), MOCK. The parent renders this only when the server-derived
 * `terminal.run` capability is present, so for everyone else it is absent from the page and from the
 * lazy chunk they download. Nothing typed here is sent anywhere in M3.
 */
export default function SqlTerminal({ orgName, capPx }: { orgName: string; /** Largest body height in px (the builder passes about 50% of the editor). */ capPx?: () => number }) {
  // Collapsed by default; the choice is remembered per browser (preference only, read after mount so SSR matches).
  const [open, setOpen] = useState(false)
  useEffect(() => { try { if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true) } catch { /* storage blocked: stay collapsed */ } }, [])
  const toggle = () => setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch { /* ignore */ } return !o })
  const [height, setHeight] = useState(240)
  const drag = useRef<{ y: number; h: number } | null>(null)
  const cap = () => Math.max(120, capPx?.() ?? Math.floor((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.5))
  const clamp = (h: number) => Math.round(Math.min(cap(), Math.max(96, h)))
  const [sql, setSql] = useState('SELECT unit_group, country, count(*) AS events\nFROM mock_events\nGROUP BY 1, 2')
  const [out, setOut] = useState<RunOutcome | null>(null)
  const run = () => setOut(runMock(sql))
  return (
    <GlassPanel tone={2} spotlight={false} sheen={false} className="min-w-0 shrink-0 p-3" aria-label="SQL terminal">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-expanded={open} onClick={toggle} className="flex items-center gap-2 rounded px-1 font-display text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
          {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronUp className="size-4" aria-hidden />}
          SQL terminal
        </button>
        <span className="truncate text-xs text-brand-text-muted">Director only · {orgName} · mock, nothing is sent</span>
      </div>
      {open ? (
        <>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal (drag, or Up and Down arrows)"
          aria-valuenow={height}
          aria-valuemin={96}
          tabIndex={0}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, h: height } }}
          onPointerMove={(e) => { if (drag.current) setHeight(clamp(drag.current.h + (drag.current.y - e.clientY))) }}
          onPointerUp={() => { drag.current = null }}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); setHeight((h) => clamp(h + 24)) } else if (e.key === 'ArrowDown') { e.preventDefault(); setHeight((h) => clamp(h - 24)) } }}
          className="-mx-3 mt-1 h-2 cursor-row-resize touch-none border-y border-brand-border bg-brand-surface-raised/60 hover:bg-brand-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        />
        <div className="mt-2 space-y-2 overflow-y-auto overflow-x-hidden pr-1" style={{ height: Math.min(height, cap()) }}>
          <label className="block text-xs text-brand-text-muted" htmlFor="sql-input">One SELECT statement</label>
          <textarea
            id="sql-input"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() } }}
            rows={4}
            spellCheck={false}
            className="w-full rounded-md border border-brand-border-strong bg-brand-primary p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={run} className="flex items-center gap-1.5 rounded-md bg-brand-accent px-3 py-1.5 text-sm font-medium text-brand-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text">
              <Play className="size-3.5" aria-hidden /> Run (Ctrl+Enter)
            </button>
            <span className="rounded-full border border-brand-border-strong px-2 py-0.5 text-xs">Results are unfiltered by R1</span>
            <span className="text-xs text-brand-text-muted">Row cap: {ROW_CAP.toLocaleString('en-ZA')}</span>
          </div>
          <div role="status" aria-live="polite">
            {out && !out.ok ? <p role="alert" className="rounded-md border border-brand-danger p-2 text-xs text-brand-danger">{out.reason}</p> : null}
            {out && out.ok ? (
              <div>
                <p className="mb-1 text-xs text-brand-text-muted">{out.note} {out.result.rows.length} rows, {out.ms} ms (fake).</p>
                <div className="max-h-56 overflow-auto rounded-md border border-brand-border">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Mock query result</caption>
                    <thead className="sticky top-0 bg-brand-surface-raised"><tr>{out.result.columns.map((c) => <th key={c} scope="col" className="px-2 py-1 font-medium">{c}</th>)}</tr></thead>
                    <tbody>{out.result.rows.map((r, i) => <tr key={i} className="border-t border-brand-border">{r.map((v, j) => <td key={j} className="px-2 py-1">{v}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </>
      ) : null}
    </GlassPanel>
  )
}
