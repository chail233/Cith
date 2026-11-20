import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { MessageBoxOptions } from 'electron'
import electronUpdater from 'electron-updater'

const DESKTOP_RELEASES = 'https://github.com/chail233/Cith/releases/tag/desktop-v'

/** 使用主进程检查版本，便携版只提示下载，安装版下载后等待用户确认。 */
export function registerDesktopUpdates(stopLocalCore: () => Promise<void>): void {
    const supported = app.isPackaged && process.platform === 'win32'
    const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
    const { autoUpdater } = electronUpdater
    let currentCheck: Promise<void> | undefined
    let interactive = false
    let installing = false

    ipcMain.handle('app:check-for-updates', () => {
        if (!supported) throw new Error('请在 Windows 发布版中检查更新')
        return check(true)
    })
    if (!supported) return

    autoUpdater.allowPrerelease = false
    autoUpdater.autoDownload = !portable
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.disableWebInstaller = true
    autoUpdater.on('error', (error) => {
        if (installing) void reportInstallError(error).catch(logError)
    })
    void check(false).catch(logError)

    function logError(error: unknown): void {
        autoUpdater.logger?.error(`应用更新失败：${String(error)}`)
    }

    function check(manual: boolean): Promise<void> {
        interactive ||= manual
        currentCheck ??= checkOnce().finally(() => {
            currentCheck = undefined
            interactive = false
        })
        return currentCheck
    }

    async function checkOnce(): Promise<void> {
        if (installing) return
        const update = await autoUpdater.checkForUpdates()
        if (!update?.isUpdateAvailable) {
            if (interactive) await showMessage({ type: 'info', message: '当前没有可用更新' })
            return
        }

        const { version } = update.updateInfo
        if (portable) {
            const { response } = await showMessage({
                type: 'info',
                message: `发现新版本 v${version}`,
                buttons: ['稍后', '前往下载'],
                cancelId: 0,
            })
            if (response === 1) await shell.openExternal(DESKTOP_RELEASES + encodeURIComponent(version))
            return
        }

        if (!update.downloadPromise) throw new Error('未能下载更新包')
        await update.downloadPromise
        const { response } = await showMessage({
            type: 'info',
            message: `v${version} 已下载，是否重启更新？`,
            detail: '重启前会停止本地核心。',
            buttons: ['稍后', '重启更新'],
            cancelId: 0,
        })
        if (response !== 1) return

        installing = true
        try {
            await stopLocalCore()
            autoUpdater.quitAndInstall(true, true)
        }
        catch (error) {
            await reportInstallError(error)
        }
    }

    async function reportInstallError(error: unknown): Promise<void> {
        installing = false
        const detail = error instanceof Error ? error.message : String(error)
        await showMessage({ type: 'error', message: '更新安装失败', detail })
    }
}

function showMessage(options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
}
