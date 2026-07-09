import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // the project lives on a secondary drive where native fs events are unreliable
    watch: { usePolling: true, interval: 300 },
  },
})
