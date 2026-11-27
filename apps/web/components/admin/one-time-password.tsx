'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { GlassPanel } from '@/components/fx/glass-panel'
import { btnCls, inputCls, primaryCls } from './ui'

/** A password the server returned once. Held in component state only: never stored, never in a URL or a cache. */
export interface IssuedPassword {
  username: string
  password: string
  /** Where focus goes back to when the panel closes. */
  trigger: HTMLElement | null
}

/** Dialog that shows a one-time password until dismissed. A click outside does NOT close it: it cannot be reopened. */
export function OneTimePassword({ issued, onClose }: { issued: IssuedPassword; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const copyButton = useRef<HTMLButtonElement>(null)
  const [status, setStatus] = useState('')
  const { username, password, trigger } = issued

  useEffect(() => {
    copyButton.current?.focus()
    return () => trigger?.focus()
  }, [trigger])
  // Leaving the document (also into the back/forward cache) drops the password.
  useEffect(() => {
    window.addEventListener('pagehide', onClose)
    return () => window.removeEventListener('pagehide', onClose)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password)
      setStatus('Copied')
    } catch {
      // The clipboard API is missing over plain http.
      field.current?.focus()
      field.current?.select()
      const done = typeof document.execCommand === 'function' && document.execCommand('copy')
      setStatus(done ? 'Copied' : 'Copy failed. The password is selected: copy it yourself.')
    }
  }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>('input,button')]
    const first = items[0]!, last = items[items.length - 1]!
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="otp-title" aria-describedby="otp-note" onKeyDown={key} className="w-full max-w-md">
        <GlassPanel tone={3} spotlight={false} sheen={false} className="p-4">
          <h2 id="otp-title" className="font-display text-base font-semibold">One-time password</h2>
          <p className="mt-2 text-sm">Username: <span className="font-mono font-medium">{username}</span></p>
          <label htmlFor="otp-value" className="mb-0.5 mt-2 block text-xs font-medium">Password</label>
          <div className="flex gap-2">
            <input id="otp-value" ref={field} readOnly value={password} onFocus={(e) => e.target.select()} autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} />
            <button ref={copyButton} type="button" className={btnCls} onClick={() => void copy()}><Copy className="size-3.5" aria-hidden /> Copy</button>
          </div>
          <p role="status" aria-live="polite" className="mt-1 min-h-4 text-xs text-brand-text-muted">{status}</p>
          <p id="otp-note" className="mt-1 text-sm">This password is shown once and cannot be recovered. Give it to the person now.</p>
          <div className="mt-3 flex justify-end"><button type="button" className={primaryCls} onClick={onClose}>Done</button></div>
        </GlassPanel>
      </div>
    </div>
  )
}
