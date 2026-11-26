import type { OrgAccess } from '@omnimetrics/types'
import type * as A from '../mock/admin' // types only: there is no mock fallback here
import type { Portal } from '../types'
import * as content from './content'
import * as dashboards from './dashboards'
import { assertOrgCtx, type OrgCtx } from './org'
import * as orgs from './orgs'

/** The Portal interface speaks OrgAccess; pg accepts only what requireOrg() issued. */
function own(ctx: OrgAccess): OrgCtx {
  assertOrgCtx(ctx)
  return ctx
}

/** Fail closed: everything outside this stage throws instead of falling back to the mock. */
const todo = (name: string) => (): never => {
  throw new Error(`Portal pg: ${name} is not implemented in stage 2a`)
}

const integrations: typeof A.integrations = {
  list: todo('integrations.list'),
  save: todo('integrations.save'),
  remove: todo('integrations.remove'),
  test: todo('integrations.test'),
  audit: todo('integrations.audit'),
  hosts: { list: todo('integrations.hosts.list'), add: todo('integrations.hosts.add'), remove: todo('integrations.hosts.remove') },
}
const organisations: typeof A.organisations = { list: todo('organisations.list'), create: todo('organisations.create'), update: todo('organisations.update') }
const users: typeof A.users = { list: todo('users.list'), add: todo('users.add'), update: todo('users.update'), memberships: todo('users.memberships') }
const accounts: typeof A.accounts = { sessions: todo('accounts.sessions'), revoke: todo('accounts.revoke'), resetPassword: todo('accounts.resetPassword') }
const account: typeof A.account = { sessions: todo('account.sessions'), revoke: todo('account.revoke'), changePassword: todo('account.changePassword') }
const settings: typeof A.settings = { get: todo('settings.get'), set: todo('settings.set') }

export const pgPortal: Portal = {
  mode: 'pg',
  orgs: { listAccessible: orgs.listAccessible, listAll: orgs.listAll },
  content: {
    tree: async (ctx) => content.tree(own(ctx)),
    apply: async (ctx, op) => content.apply(own(ctx), op),
  },
  dashboards: {
    get: async (ctx, nodeId) => dashboards.get(own(ctx), nodeId),
    versions: async (ctx, nodeId) => dashboards.versions(own(ctx), nodeId),
    saveVersion: async (ctx, nodeId, input, author) => dashboards.saveVersion(own(ctx), nodeId, input, author),
    grants: async (ctx, nodeId) => dashboards.grants(own(ctx), nodeId),
    setGrants: async (ctx, nodeId, rows) => dashboards.setGrants(own(ctx), nodeId, rows),
  },
  integrations,
  organisations,
  users,
  accounts,
  account,
  settings,
}
