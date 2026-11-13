import { join } from 'path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'

function createWindow(): void {
    const win = new BrowserWindow({
        width: 960,
        height: 680,
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
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})
