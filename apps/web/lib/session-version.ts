/**
 * SESSION_VERSION=1 turns on token versions (app_users.token_version, migration 012). Any other value, or none,
 * is OFF: no tv claim, token_version is in no SQL text, nothing is compared. Edge-safe.
 */
export const sessionVersionEnabled = (): boolean => process.env.SESSION_VERSION === '1'
