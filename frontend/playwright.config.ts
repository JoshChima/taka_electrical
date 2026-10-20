import { defineConfig } from '@playwright/test'

// Test seam 2: the one smoke test against the real Docker stack. See e2e/smoke.spec.ts.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: process.env.SMOKE_BASE_URL },
})
