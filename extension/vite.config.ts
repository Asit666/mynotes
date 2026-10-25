import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { defineConfig } from 'vite'
import manifest from './src/manifest.js'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: ['index.html', 'sidepanel.html', 'offscreen.html'],
    },
  },
})
