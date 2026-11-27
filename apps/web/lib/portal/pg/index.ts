import type { OrgAccess } from '@omnimetrics/types'
import type * as A from '../mock/admin' // types only: there is no mock fallback here
import type { Portal } from '../types'
import * as account_ from './account'
import * as content from './content'
import * as dashboards from './dashboards'
import { assertOrgCtx, type OrgCtx } from './org'
import * as organisationsRepo from './organisations'
import * as orgs from './orgs'
import * as settingsRepo from './settings'
import * as usersRepo from './users'

/** The Portal interface speaks OrgAccess; pg accepts only what requireOrg() issued. */
function own(ctx: OrgAccess): OrgCtx {
  assertOrgCtx(ctx)
  return ctx
}

/** Fail closed: everything outside this stage throws instead of falling back to the mock. */
const todo = (name: string) => (): never => {
  throw new Error(`Portal pg: ${name} is not implemented yet`)
}

const integrations: typeof A.integrations = {
  list: todo('integrations.list'),
  save: todo('integrations.save'),
  remove: todo('integrations.remove'),
  test: todo('integrations.test'),
  audit: todo('integrations.audit'),
  hosts: { list: todo('integrations.hosts.list'), add: todo('integrations.hosts.add'), remove: todo('integrations.hosts.remove') },
}
const organisations: Portal['organisations'] = {
  list: async (c) => organisationsRepo.list(own(c)),
  create: async (c, actor, name, slug) => organisationsRepo.create(own(c), actor, name, slug),
  update: async (c, actor, id, patch) => organisationsRepo.update(own(c), actor, id, patch),
}
const users: Portal['users'] = {
  list: async (c) => usersRepo.list(own(c)),
  add: async (c, actor, input) => usersRepo.add(own(c), actor, input),
  link: async (c, actor, input) => usersRepo.link(own(c), actor, input),
  update: async (c, actor, userId, patch) => usersRepo.update(own(c), actor, userId, patch),
  memberships: todo('users.memberships'),
}
// The session list and revoking ONE session need a sessions table (none exists): not implemented, fail closed.
const accounts: Portal['accounts'] = {
  sessions: todo('accounts.sessions'),
  revoke: todo('accounts.revoke'),
  resetPassword: async (c, actor, userId) => account_.resetPassword(own(c), actor, userId),
}
const account: Portal['account'] = { sessions: todo('account.sessions'), revoke: todo('account.revoke'), revokeSessions: account_.revokeSessions, changePassword: account_.changePassword }
// The repository takes the person from the ctx; the actor only supplies the audit ip.
const settings: Portal['settings'] = {
  get: async (c) => settingsRepo.get(own(c)),
  set: async (c, actor, scope, values, unset) => settingsRepo.set(own(c), actor, scope, values, unset),
}

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
