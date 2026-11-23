import { z } from 'zod'
import { MAX_NAME_LENGTH } from '@omnimetrics/types'

const id = z.string().min(1).max(64)
const name = z.string().max(MAX_NAME_LENGTH * 2)

/** Request body for tree mutations. Strict: unknown keys are rejected. */
export const ContentOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), kind: z.enum(['folder', 'dashboard']), parentId: id.nullable(), name }).strict(),
  z.object({ op: z.literal('rename'), id, name }).strict(),
  z.object({ op: z.literal('move'), id, parentId: id.nullable(), index: z.number().int().min(0).max(10_000).optional() }).strict(),
  z.object({ op: z.literal('delete'), id }).strict(),
  z.object({ op: z.literal('restore'), batchId: id }).strict(),
])
