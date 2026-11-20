'use client'

import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { isFxLevel, type FxLevel } from './fx-core'

const FxScopeContext = createContext<FxLevel | null>(null)

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fx'] })
  return () => mo.disconnect()
}
function getSnapshot(): FxLevel {
  const v = document.documentElement.getAttribute('data-fx')
  return isFxLevel(v) ? v : 'full'
}
const getServerSnapshot = (): FxLevel => 'full'

/** Effective level for this subtree: the nearest FxScope, else <html data-fx>. */
export function useFxLevel(): FxLevel {
  const scoped = useContext(FxScopeContext)
  const global = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return scoped ?? global
}

/**
 * Pins a subtree to one level (CSS via data-fx, JS via context). Used by /dev/ui;
 * the OS reduced-motion setting still overrides motion inside it.
 */
export function FxScope({
  level,
  className,
  children,
}: {
  level: FxLevel
  className?: string
  children: ReactNode
}) {
  return createElement(
    FxScopeContext.Provider,
    { value: level },
    createElement('div', { 'data-fx': level, className }, children),
  )
}
