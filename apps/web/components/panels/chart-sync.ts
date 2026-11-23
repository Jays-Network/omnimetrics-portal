'use client'

import { createContext, useContext } from 'react'

/** Dashboard setting "shared crosshair / shared tooltip": charts that share this id link their cursor (recharts `syncId`). */
export const ChartSyncContext = createContext<string | undefined>(undefined)
export const useChartSync = () => useContext(ChartSyncContext)
