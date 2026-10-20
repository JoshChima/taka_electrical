import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// `npm run dev` proxies the API to a running InvenTree. Django checks the Origin header against
// INVENTREE_SITE_URL, so the proxy presents itself as that origin.
const inventree = process.env.INVENTREE_URL ?? 'http://localhost'

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    proxy: { '/api': { target: inventree, changeOrigin: true, headers: { origin: inventree } } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
  },
})
