import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A plain multi-entry build. Every entry keeps a fixed name because
// manifest.json and the offscreen document refer to them by path:
//   popup.html / offscreen.html  - extension pages
//   background.js                - the MV3 service worker (type: module)
//   audio-worklet.js             - loaded with audioWorklet.addModule(); it
//                                  imports nothing, so it stays one file
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    // The preload polyfill is not needed in Chrome and would be one more script.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: 'popup.html',
        offscreen: 'offscreen.html',
        background: 'src/background/index.ts',
        'audio-worklet': 'src/lib/audio-worklet.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
