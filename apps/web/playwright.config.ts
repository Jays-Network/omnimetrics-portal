import { defineConfig } from '@playwright/test'

// Layout tests run against the ALREADY RUNNING dev server on :3002. No webServer block on purpose:
// this config never starts a second server and never builds.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  retries: 1, // the dev server compiles on first hit and occasionally answers 500 once while it does
  reporter: [['list']],
  outputDir: './test-results',
  use: { baseURL: process.env.LAYOUT_BASE_URL ?? 'http://localhost:3002', browserName: 'chromium' },
})
