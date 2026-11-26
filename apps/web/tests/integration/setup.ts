import path from 'node:path'

// Only apps/web/.env.test is loaded. The application URLs are removed, so nothing in a test run can
// reach the real database through them: the harness hands the repositories its own clients.
delete process.env.DATABASE_URL
delete process.env.DATABASE_URL_PLATFORM
delete process.env.DATABASE_URL_READONLY
try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env.test'))
} catch {
  throw new Error('test:db needs apps/web/.env.test with TEST_DATABASE_URL_APP and TEST_DATABASE_URL_PLATFORM')
}
