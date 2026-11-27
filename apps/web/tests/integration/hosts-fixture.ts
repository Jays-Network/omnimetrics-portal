import { connect } from './harness'

/**
 * COMMITTED allowed hosts, added and removed over a separate platform connection: the two held test
 * transactions cannot see each other's rows, and portal_app cannot write hosts. 011 gives only localhost.
 * Call the returned cleanup AFTER the world is closed. An interrupted run leaves harmless .invalid rows.
 */
export async function committedHost(host: string, orgId: string | null = null): Promise<() => Promise<void>> {
  const platform = await connect('TEST_DATABASE_URL_PLATFORM')
  await platform`
    INSERT INTO app_allowed_hosts (org_id, host, port_min, port_max, note)
    VALUES (${orgId}, ${host}, 5432, 5439, 'itest')
    ON CONFLICT ON CONSTRAINT app_allowed_hosts_unique DO NOTHING`
  return async () => {
    await platform`DELETE FROM app_allowed_hosts WHERE host = ${host} AND note = 'itest'`
    await platform.end({ timeout: 5 })
  }
}
