import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()]
    },
    preload: {
        plugins: [externalizeDepsPlugin()]
    },
    renderer: {
        plugins: [react()],
        build: {
            // 字体以独立文件加载，符合渲染层 CSP。
            assetsInlineLimit: (filePath) => filePath.endsWith('.woff2') ? false : undefined
        }
    }
})
