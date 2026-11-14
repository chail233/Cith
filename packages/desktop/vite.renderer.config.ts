import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 仅供浏览器预览渲染层（npm run dev:web）做视觉调试；Electron 构建走 electron.vite.config.ts
export default defineConfig({
    root: 'src/renderer',
    plugins: [react()],
    server: { port: 5199 },
})
