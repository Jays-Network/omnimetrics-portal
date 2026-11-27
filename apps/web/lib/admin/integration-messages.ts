// Refusal texts shared by the mock and pg integrations so both answer the same way. Client-safe.
export const HOST_NOT_ALLOWED = 'That host is not on the allowed list. Ask the director to add it.'
export const portOutOfRange = (port: number, min: number, max: number) => `Port ${port} is outside the allowed range ${min} to ${max} for this host.`
export const INTEGRATION_NAME_TAKEN = 'Another integration already uses that name.'
export const CREDENTIALS_REQUIRED = 'Credentials are required for a new integration.'
/** Otherwise a stored credential could be sent to a different server just by pressing Test. */
export const CREDENTIALS_REQUIRED_ON_MOVE = 'Changing the host, port, database or SSL mode needs the credentials to be entered again.'
export const HOST_RESERVED = "This server, link-local addresses and the portal's own database are only for managed sources. Choose another host."
export const MANAGED_NO_EDIT = 'The managed local database cannot be edited.'
export const MANAGED_NO_DELETE = 'The managed local database cannot be deleted.'
export const HOST_LISTED = 'That host is already on the list.'
export const hostInUse = (n: number) => `In use by ${n} integration${n === 1 ? '' : 's'}. Remove those first.`
export const testsLimited = (seconds: number, perMinute: number, scope = '') => `Too many connection tests. Try again in ${seconds} seconds (limit: ${perMinute} per minute${scope}).`
