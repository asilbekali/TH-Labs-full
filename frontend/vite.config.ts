import { defineConfig } from 'vite'
import type { ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Two different backends sit behind this app, and they are not interchangeable:
//
//   /api, /media  → the dubbing pipeline (FastAPI, :8000 on the server box).
//                   Jobs and result playback only. This box is frequently
//                   asleep, so anything proxied here 502s at those times —
//                   which is why health and the language catalog were moved
//                   off it and onto /v1 (see src/lib/api.ts).
//   /v1           → the account API (NestJS): auth, users, subscriptions,
//                   Stripe, health, languages. In production https://th-labs.uz/v1.
//
// NOTE: `/docs` is the Swagger UI — a page for humans. It is NOT the API base,
// and every route on it is listed under /v1. Pointing the app at /docs makes
// each call land on /docs/payments/plans, which is a 404 with no CORS headers.

const DUB_HOST = '46.224.138.121'
const ACCOUNT_API = 'https://th-labs.uz'

// Dev-only rewrite of the refresh cookie.
//
// The deployed API runs NODE_ENV=production, so it issues the cookie with
// `Secure; SameSite=None` — correct for the real Studio, which is https and
// cross-origin. But the dev server is plain http://localhost, and Safari
// refuses to store a Secure cookie over http even on localhost. The cookie is
// dropped silently, so sign-in never sticks and every authenticated call 401s
// while public ones like /payments/plans keep working.
//
// Stripping Secure and relaxing SameSite here is safe precisely because it is
// scoped to the dev server on localhost; nothing about the deployed cookie
// changes. Without it you cannot sign in against the real API from a browser.
const relaxCookieForLocalhost: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyRes', (proxyRes) => {
    const cookies = proxyRes.headers['set-cookie']
    if (!cookies) return
    proxyRes.headers['set-cookie'] = cookies.map((c) =>
      c.replace(/;\s*Secure/gi, '').replace(/;\s*SameSite=None/gi, '; SameSite=Lax'),
    )
  })
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://${DUB_HOST}:8000`, changeOrigin: true },
      '/media': { target: `http://${DUB_HOST}:8000`, changeOrigin: true },
      // Proxied rather than called directly so the browser sees a same-origin
      // request: the deployed API's CORS allowlist covers the real Studio
      // origin, not localhost, so a direct fetch is refused before it is sent.
      // Server-to-server hops like this one are not subject to CORS at all.
      '/v1': {
        target: ACCOUNT_API,
        changeOrigin: true,
        secure: true,
        configure: relaxCookieForLocalhost,
      },
    },
  },
})
