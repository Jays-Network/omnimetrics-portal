'use client'

import { createContext, useContext } from 'react'

/**
 * Which data layer serves this page (set by AppShell), for wording that is only true on the mock.
 * Presentation only. Defaults to "mock" so a screen rendered without a shell never claims to be real.
 */
const PortalModeContext = createContext<'mock' | 'pg'>('mock')
export const PortalModeProvider = PortalModeContext.Provider
export const usePortalMode = () => useContext(PortalModeContext)
