import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// `pnpm test:db`: the pg repositories against the throwaway database portal_test ONLY (see
// tests/integration/harness.ts, which refuses any other database or role).
export default defineConfig({
  plugins: [react()], // the dashboard model imports the panel registry (.tsx)
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.itest.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    fileParallelism: false, // one shared database; per-organisation advisory locks are held until rollback
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
