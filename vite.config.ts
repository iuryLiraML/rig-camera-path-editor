/// <reference types="vitest/config" />
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { agentApiDevPlugin } from './api/_lib/vitePlugin'

export default defineConfig(({ mode }) => ({
  // Keep the browser test server's optimizer separate from a running editor.
  cacheDir: process.env.RIG_VITE_CACHE_DIR,
  resolve: { dedupe: ['react', 'react-dom'] },
  // site keys for the agent proxy come from .env.local (never VITE_-prefixed)
  plugins: [react(), tailwindcss(), agentApiDevPlugin({ ...process.env, ...loadEnv(mode, process.cwd(), '') })],
  build: { target: 'es2022' },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync(resolve('node_modules/@fontsource-variable/inter/files'))] },
    /*
     * Bind IPv4 explicitly. Default "localhost" is [::1] on this host, so
     * http://127.0.0.1:5173 fails while http://localhost:5173 serves a
     * different clone. Vite does not read PORT on its own: it would try 5173,
     * find it busy and silently move to 5174, which breaks anything pinned to
     * the origin (the Google OAuth authorized origin and CORS_ALLOWED_ORIGINS
     * are both http://localhost:5173 — see docs/SETUP-CLOUD.md). Reading PORT
     * lets the harness assign a port, and strictPort turns a taken port into an
     * error instead of a wrong origin nobody notices.
     */
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    // the project lives on a secondary drive where native fs events are unreliable
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    setupFiles: ['src/test/localStorageSetup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/browser/**'],
  },
}))
