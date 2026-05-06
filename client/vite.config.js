import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron loads the built app from the filesystem (file://), so asset URLs
// must be relative. For the web/docker build, relative paths still resolve
// correctly under the nginx root.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true, changeOrigin: true },
    },
  },
})
