import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR,
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        '**/presenter-bridge/**/bin/**',
        '**/presenter-bridge/**/obj/**',
      ],
    },
  },
})
