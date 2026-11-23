'use client'

import { useLayoutEffect, useRef, useState } from 'react'

export interface Size { width: number; height: number }

/**
 * Measures an element's own layout box (unscaled) (ResizeObserver, so grid resizes, window resizes and
 * browser zoom all re-measure). Renderers get these numbers instead of using fixed pixel sizes.
 * Returns 0x0 until the first measurement; callers render nothing until they have a real size.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      // clientWidth/Height are LAYOUT sizes: unaffected by the artboard's CSS scale transform
      // (getBoundingClientRect would return the scaled size and the renderer would shrink twice).
      const next = { width: el.clientWidth, height: el.clientHeight }
      setSize((p) => (p.width === next.width && p.height === next.height ? p : next))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}
