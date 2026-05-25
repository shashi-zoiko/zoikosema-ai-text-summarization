import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Web build needs absolute '/' so assets resolve at /assets/* regardless of
// the SPA deep-link path (e.g. /meet/<code>, /chat/<id>). With './', the
// browser resolves ./assets/foo.js against /meet/<code> → /meet/assets/foo.js,
// which the FastAPI catch-all serves as index.html and the browser then
// rejects with a MIME-type error, leaving a blank page.
// Electron loads from file:// and needs './', so the electron:* scripts set
// VITE_BASE=./ before invoking vite build.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8001', ws: true, changeOrigin: true },
    },
  },
  build: {
    // Pre-split big vendor libs so they don't piggyback into a random page
    // chunk (which is what caused the 152 kB "Badge" chunk before). With
    // these in their own files, every page chunk drops several KB and the
    // browser caches the vendor file independently across page loads.
    //
    // Vite 8 uses rolldown, which only accepts the function form of
    // manualChunks (not the object map Rollup-classic supported).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('livekit-client') || id.includes('@livekit/')) return 'vendor-livekit'
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) return 'vendor-react'
        },
      },
    },
  },
})
