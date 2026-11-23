import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Layout tests run against the ALREADY RUNNING dev server on :3002. No webServer block on purpose:
// this config never starts a second server and never builds.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  retries: 0, // M3.4: a 500 must fail loudly, never be retried away
  reporter: [['list']],
  // Never inside the watched app dir: files written there trigger a dev recompile that answers 500 mid-test.
  outputDir: (process.env.LAYOUT_OUT ?? join(tmpdir(), 'omni-e2e')) + '/results',
  use: { baseURL: process.env.LAYOUT_BASE_URL ?? 'http://localhost:3002', browserName: 'chromium' },
})
