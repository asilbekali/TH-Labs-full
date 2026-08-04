import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The backend (FastAPI) runs on :8000. In dev we proxy /api and /media to it so
// the app can use same-origin relative URLs (which also work in production
// behind a single reverse proxy).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      // The NestJS account API (login/logout/register) runs on :3001 under /v1.
      '/v1': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
})
