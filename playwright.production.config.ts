import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Layout regressions must also run against emitted CSS/JS, without Vite's dev transforms. */
export default defineConfig({
  ...base,
  testMatch: 'add-object-layout.spec.ts',
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
