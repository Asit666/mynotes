import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/content.ts',
      name: 'AiVideoNotesContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
})
