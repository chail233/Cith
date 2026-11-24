import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { MessageBoxOptions } from 'electron'
import electronUpdater from 'electron-updater'
import type { DesktopUpdateState, DesktopUpdateStatus } from '../shared/update.ts'

const DESKTOP_RELEASES = 'https://github.com/chail233/Cith/releases/tag/desktop-v'

/** 更新状态留在主进程，窗口打开后可读取当前进度。 */
export function registerDesktopUpdates(
    stopLocalCore: () => Promise<void>,
    shouldAutoDownload: () => boolean,
): () => void {
    const supported = app.isPackaged && process.platform === 'win32'
    const mode = !supported ? 'unsupported' : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer'
    const { autoUpdater } = electronUpdater
    let status: DesktopUpdateStatus = { phase: 'idle' }
    let pending: Promise<void> | undefined

    ipcMain.handle('app:update-state', snapshot)
    ipcMain.handle('app:check-for-updates', () => {
        if (!supported) throw new Error('请在 Windows 发布版中检查更新')
        return run(check)
    })
    ipcMain.handle('app:download-update', requestDownload)
    ipcMain.handle('app:install-update', () => run(confirmInstall))

    if (supported) {
        autoUpdater.allowPrerelease = false
        // 由主进程按已保存的设置启动下载，同时记录进度和失败状态。
        autoUpdater.autoDownload = false
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.disableWebInstaller = true
        autoUpdater.on('download-progress', ({ percent }) => {
            if (status.phase !== 'downloading' || !Number.isFinite(percent)) return
            const progress = Math.floor(Math.min(100, Math.max(0, percent)))
            if (status.percent !== progress) publish({ ...status, percent: progress })
        })
        autoUpdater.on('error', (error) => {
            // 检查和下载的错误由各自的 Promise 报告，quitAndInstall 也可能单独发事件。
            if (status.phase === 'installing') reportError(error)
        })
        void run(check)
    }

    return () => {
        if (mode === 'installer' && status.phase === 'available') void requestDownload()
    }

    function snapshot(): DesktopUpdateState {
        return { mode, status }
    }

    function publish(next: DesktopUpdateStatus): void {
        status = next
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('app:update-status', snapshot())
        }
    }

    function run(action: () => Promise<void>): Promise<void> {
        pending ??= Promise.resolve().then(action).catch(reportError).finally(() => {
            pending = undefined
        })
        return pending
    }

    async function check(): Promise<void> {
        if (status.phase === 'installing' || status.phase === 'downloaded') return
        publish({ phase: 'checking' })
        const update = await autoUpdater.checkForUpdates()
        if (!update?.isUpdateAvailable) {
            publish({ phase: 'current' })
            return
        }

        const { version } = update.updateInfo
        if (mode === 'installer' && shouldAutoDownload()) {
            await download(version)
            return
        }
        publish({ phase: 'available', version })
        if (mode === 'portable') {
            const response = await showMessage({
                type: 'info',
                message: `发现新版本 v${version}`,
                buttons: ['稍后', '前往下载'],
                cancelId: 0,
            })
            if (response === 1) await openRelease(version)
        }
    }

    function requestDownload(): Promise<void> {
        return run(async () => {
            if (status.phase !== 'available') return
            if (mode === 'portable') await openRelease(status.version)
            else await download(status.version)
        })
    }

    function openRelease(version: string): Promise<void> {
        return shell.openExternal(DESKTOP_RELEASES + encodeURIComponent(version))
    }

    async function download(version: string): Promise<void> {
        publish({ phase: 'downloading', version })
        await autoUpdater.downloadUpdate()
        publish({ phase: 'downloaded', version })
        await confirmInstall()
    }

    async function confirmInstall(): Promise<void> {
        if (status.phase !== 'downloaded') return
        const { version } = status
        const response = await showMessage({
            type: 'info',
            message: `v${version} 已下载，是否重启更新？`,
            detail: '重启前会停止本地核心。',
            buttons: ['稍后', '重启更新'],
            cancelId: 0,
        })
        if (response !== 1) return

        publish({ phase: 'installing', version })
        await stopLocalCore()
        autoUpdater.quitAndInstall(true, true)
    }

    function reportError(error: unknown): void {
        autoUpdater.logger?.error(`应用更新失败：${String(error)}`)
        const detail = error instanceof Error ? error.message : String(error)
        switch (status.phase) {
            case 'downloading':
                publish({ phase: 'available', version: status.version, error: `下载失败：${detail}` })
                break
            case 'installing':
            case 'downloaded':
                publish({ phase: 'downloaded', version: status.version, error: `更新安装失败：${detail}` })
                break
            case 'available':
                publish({ ...status, error: `打开发布页失败：${detail}` })
                break
            default:
                publish({ phase: 'error', error: `检查更新失败：${detail}` })
        }
    }
}

async function showMessage(options: MessageBoxOptions): Promise<number> {
    const windows = BrowserWindow.getAllWindows()
    const window = BrowserWindow.getFocusedWindow() ?? windows.find((win) => win.isVisible())
    // 托盘状态下只更新侧栏提示，用户恢复窗口后可继续操作。
    if (!window && windows.length > 0) return options.cancelId ?? 0
    const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
    return response
}
