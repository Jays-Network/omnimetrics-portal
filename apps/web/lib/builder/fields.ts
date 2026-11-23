// MOCK dataset catalogue for the block panel (M3). Plain-language labels over an allowlist of columns.
// In M5 this comes from the server per dataset and role; the browser never invents a field.
export type FieldType = 'text' | 'number' | 'date'

export interface FieldDef {
  id: string
  label: string
  type: FieldType
  /** Hidden for these roles (sensitive fields can be hidden per role). */
  hiddenFor?: ('viewer' | 'builder')[]
}

export const MOCK_FIELDS: FieldDef[] = [
  { id: 'event_time', label: 'Event time', type: 'date' },
  { id: 'unit_group', label: 'Unit group', type: 'text' },
  { id: 'country', label: 'Country', type: 'text' },
  { id: 'status', label: 'Status', type: 'text' },
  { id: 'unit_id', label: 'Unit', type: 'text' },
  { id: 'trips', label: 'Trips', type: 'number' },
  { id: 'distance_km', label: 'Distance (km)', type: 'number' },
  { id: 'dwell_hours', label: 'Dwell time (hours)', type: 'number' },
]

export const fieldById = (id: string): FieldDef | undefined => MOCK_FIELDS.find((f) => f.id === id)
export const fieldLabel = (id: string): string => fieldById(id)?.label ?? id

export type FilterOp = 'eq' | 'neq' | 'in' | 'between' | 'contains'
export const OP_LABEL: Record<FilterOp, string> = { eq: 'is', neq: 'is not', in: 'is one of', between: 'is between', contains: 'contains' }

/** Operators a field type allows (typed slots). */
export const OPS_FOR: Record<FieldType, FilterOp[]> = {
  text: ['eq', 'neq', 'in', 'contains'],
  number: ['eq', 'neq', 'between'],
  date: ['between'],
}

export type MeasureFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'
export const FN_LABEL: Record<MeasureFn, string> = { count: 'Count', count_distinct: 'Count distinct', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' }
/** Field types each function accepts; `count` takes no field. */
export const FN_FIELD: Record<MeasureFn, FieldType[] | null> = {
  count: null,
  count_distinct: ['text', 'number', 'date'],
  sum: ['number'],
  avg: ['number'],
  min: ['number', 'date'],
  max: ['number', 'date'],
}

export const GRAINS = ['hour', 'day', 'week', 'month'] as const
export type Grain = (typeof GRAINS)[number]
