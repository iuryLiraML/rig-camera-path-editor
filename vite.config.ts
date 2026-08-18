import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { agentApiDevPlugin } from './api/_lib/vitePlugin'

export default defineConfig(({ mode }) => ({
  // site keys for the agent proxy come from .env.local (never VITE_-prefixed)
  plugins: [react(), tailwindcss(), agentApiDevPlugin({ ...process.env, ...loadEnv(mode, process.cwd(), '') })],
  server: {
    /*
     * Vite does not read PORT on its own: it would try 5173, find it busy and
     * silently move to 5174, which breaks anything pinned to the origin (the
     * Google OAuth authorized origin and CORS_ALLOWED_ORIGINS are both
     * http://localhost:5173 — see docs/SETUP-CLOUD.md). Reading PORT lets the
     * harness assign a port, and strictPort turns a taken port into an error
     * instead of a wrong origin nobody notices.
     */
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
}))
