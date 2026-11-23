'use client'

import type { DashVersion } from '@/lib/builder/model'

/** Version history, newest first, with Restore. Append-only: restoring adds a new version. Used in the editor panel and in Settings. */
export function VersionsPane({ versions, note, onNote, busy, onRestore }: { versions: DashVersion[]; note: string; onNote: (s: string) => void; busy: boolean; onRestore: (n: number) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs">Note for the next version
        <input value={note} maxLength={120} onChange={(e) => onNote(e.target.value)} placeholder="What changed" className="mt-0.5 h-8 w-full rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
      </label>
      <ol className="m-0 space-y-1.5 p-0" aria-label="Version history, newest first">
        {[...versions].reverse().map((v, i) => (
          <li key={v.n} className="flex list-none items-start justify-between gap-2 rounded-md border border-brand-border p-2 text-xs">
            <span className="min-w-0">
              <span className="font-semibold">v{v.n}</span>{i === 0 ? <span className="ml-1 text-brand-accent">current</span> : null}
              <span className="block break-words text-brand-text-muted">{v.note}</span>
              <span className="block text-brand-text-muted">{v.author} · {new Date(v.createdAt).toLocaleString('en-ZA')}</span>
            </span>
            {i === 0 ? null : <button type="button" disabled={busy} onClick={() => onRestore(v.n)} className="shrink-0 rounded border border-brand-border-strong px-2 py-1 hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-50">Restore</button>}
          </li>
        ))}
      </ol>
      <p className="text-xs text-brand-text-muted">History is append-only: restoring adds a new version, nothing is overwritten. Settings are part of every version.</p>
    </div>
  )
}
