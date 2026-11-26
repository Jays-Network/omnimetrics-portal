import { MAX_TREE_DEPTH, type ContentErrorCode, type ContentOp, type ContentResult } from '@omnimetrics/types'

/** Unknown, foreign and not-permitted all look the same: callers answer 404 and confirm nothing. */
export class NotFound extends Error {
  constructor() {
    super('Not found')
    this.name = 'NotFound'
  }
}

const fail = (code: ContentErrorCode, error: string): ContentResult => ({ ok: false, code, error })

/**
 * Database refusals (006 triggers and unique indexes) -> the ContentResult codes the mock returns for the
 * same rule. The shared tree rules normally answer first; this covers races and anything they miss.
 * Null = not a rule violation: the caller rethrows.
 */
export function contentErrorFrom(error: unknown, op: ContentOp): ContentResult | null {
  const e = error as { code?: string; message?: string }
  const message = e?.message ?? ''
  const moving = op.op === 'move'
  if (e?.code === '23505') return fail('conflict', 'An item with that name already exists here.')
  if (e?.code === '23503' && message.includes('parent not found')) return fail('not_found', 'That folder no longer exists.')
  if (e?.code !== '23514') return null
  if (message.includes('maximum nesting depth')) {
    return moving
      ? fail('invalid', `That would nest deeper than ${MAX_TREE_DEPTH} levels.`)
      : fail('forbidden', `Folders can be nested at most ${MAX_TREE_DEPTH} levels deep.`)
  }
  if (message.includes('moved under itself')) return fail('invalid', 'A folder cannot move into itself.')
  if (message.includes('parent must be a folder')) {
    return moving ? fail('invalid', 'Target folder not found.') : fail('forbidden', 'Items can only be created inside a folder.')
  }
  if (message.includes('parent is deleted')) return fail('not_found', 'That folder no longer exists.')
  if (message.includes('app_content_nodes_name_check')) return fail('invalid', 'That name is not allowed.')
  return null
}
