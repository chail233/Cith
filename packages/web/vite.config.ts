import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时：前端5173 BFF2146: 把/api转发给BFF

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:2146'
    },
  },
})

