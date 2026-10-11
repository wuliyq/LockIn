import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { env } from 'node:process'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': env.LOCKIN_API_PROXY || 'http://localhost:3001' } },
  preview: { proxy: { '/api': env.LOCKIN_API_PROXY || 'http://localhost:3001' } },
})
