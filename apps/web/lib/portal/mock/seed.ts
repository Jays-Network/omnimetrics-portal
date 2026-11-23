import type { StoredNode } from '../tree'

// MOCK DATA: obviously fake names, no real clients. Two organisations, two different trees.
type Seed = string | { f: string; c: Seed[] }

const WORLDRISK: Seed[] = [
  {
    f: 'Fleet Operations',
    c: [
      {
        f: 'Cross-border',
        c: [
          'Daily Overview',
          'Border Dwell Times',
          'Route Compliance',
          { f: 'Corridor A', c: ['Transit Times', 'Convoy Spacing', { f: 'Checkpoints', c: ['Checkpoint Queue Length'] }] },
          { f: 'Corridor B', c: ['Transit Times', 'Rest Stop Usage'] },
        ],
      },
      { f: 'Domestic', c: ['Daily Overview', 'Fuel and Idle', { f: 'Depot North', c: ['Gate Activity', 'Yard Occupancy'] }] },
      'Fleet Utilisation',
    ],
  },
  {
    f: 'Safety and Compliance',
    c: [
      { f: 'Incident Review', c: ['Weekly Summary', 'Near Misses', 'Open Actions'] },
      { f: 'Driver Behaviour', c: ['Harsh Events', { f: 'Night Driving', c: ['Hours Behind The Wheel', 'Fatigue Flags'] }] },
      'Compliance Scorecard',
    ],
  },
  { f: 'Maintenance', c: ['Workshop Load', 'Service Due Soon', { f: 'Tyres', c: ['Tyre Wear Trend', 'Pressure Alerts'] }] },
  { f: 'Executive', c: ['Monthly Scorecard', 'Utilisation Trend', 'Cost Per Kilometre'] },
  { f: 'Data Quality', c: ['Missing Signal Audit', 'Late Reporting Units', 'Unit Register Check'] },
]

const ADARS: Seed[] = [
  {
    f: 'Asset Registry',
    c: [
      'Registry Overview',
      { f: 'Regional Coverage', c: [{ f: 'North Zone', c: ['Coverage Map Summary', 'Unit Counts'] }, { f: 'South Zone', c: ['Coverage Map Summary'] }, 'Gaps To Close'] },
      { f: 'Lifecycle', c: ['New This Month', 'Retirements'] },
    ],
  },
  {
    f: 'Service Levels',
    c: ['SLA Summary', { f: 'Response Times', c: ['By Priority', 'By Shift', { f: 'Escalations', c: ['Escalation Ageing'] }] }],
  },
  { f: 'Billing Review', c: ['Invoice Period Check', 'Billable Units Trend', { f: 'Disputes', c: ['Open Disputes', 'Resolved Disputes'] }] },
  { f: 'Field Teams', c: ['Team Availability', 'Job Backlog'] },
  'Quarterly Review',
]

function build(prefix: string, seeds: Seed[]): StoredNode[] {
  const out: StoredNode[] = []
  let n = 0
  const walk = (list: Seed[], parentId: string | null) => {
    list.forEach((s, position) => {
      n += 1
      const id = `${prefix}-${typeof s === 'string' ? 'd' : 'f'}${n}`
      if (typeof s === 'string') {
        out.push({ id, parentId, kind: 'dashboard', name: s, position })
      } else {
        out.push({ id, parentId, kind: 'folder', name: s.f, position })
        walk(s.c, id)
      }
    })
  }
  walk(seeds, null)
  return out
}

export const seedFor = (orgSlug: string): StoredNode[] => {
  if (orgSlug === 'worldrisk') return build('wr', WORLDRISK)
  if (orgSlug === 'adars') return build('ad', ADARS)
  return []
}
