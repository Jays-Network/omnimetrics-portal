import type { Tx } from '@/lib/portal/pg/tx'

// app_allowed_hosts as seen by ONE organisation (global entries and its own). The database does NOT tie
// app_integrations.host to this table (007, 010): this check is the only enforcement.

export interface HostRange { host: string; port_min: number; port_max: number }

export const entriesFor = (tx: Tx, orgId: string, host: string) => tx<HostRange[]>`
  SELECT host, port_min, port_max
    FROM app_allowed_hosts
   WHERE lower(host) = lower(${host}) AND (org_id IS NULL OR org_id = ${orgId})
   ORDER BY org_id NULLS FIRST, port_min`

/** The entry that allows exactly this host and port, if any. */
export const covering = (entries: readonly HostRange[], port: number): HostRange | undefined =>
  entries.find((e) => port >= e.port_min && port <= e.port_max)
