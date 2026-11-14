import { join } from 'path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { BackendConnection } from './backend'
import type { BackendConfig } from '../preload/api.ts'

// 消息通道连接客户端：常驻主进程，状态与消息帧广播给所有窗口
const backend = new BackendConnection({
    onStatus: (status) => {
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('backend:status', status)
        }
    },
    onMessage: (frame) => {
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('backend:message', frame)
        }
    },
})

function createWindow(): void {
    const win = new BrowserWindow({
        width: 1120,
        height: 740,
        minWidth: 940,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#111418',
        webPreferences: {
            preload: join(import.meta.dirname, '../preload/index.mjs'),
            sandbox: false
        }
    })

    win.on('ready-to-show', () => win.show())

    // 外部链接交给系统浏览器，不在应用内开新窗口
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(() => {
    ipcMain.handle('app:get-version', () => app.getVersion())
    ipcMain.handle('backend:get-status', () => backend.current())
    ipcMain.handle('backend:apply', (_e, raw: unknown) => {
        const config = asBackendConfig(raw)
        if (config) backend.apply(config)
    })
    ipcMain.handle('backend:send', (_e, raw: unknown) => backend.send(raw))
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

/** 渲染层传来的配置做形状校验，不合形直接丢弃 */
function asBackendConfig(raw: unknown): BackendConfig | null {
    if (typeof raw !== 'object' || raw === null) return null
    const cfg = raw as Record<string, unknown>
    if (typeof cfg.url !== 'string' || typeof cfg.token !== 'string') return null
    return { url: cfg.url, token: cfg.token }
}
