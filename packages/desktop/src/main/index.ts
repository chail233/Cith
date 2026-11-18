import { join, resolve } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import { BackendConnection } from './backend'
import { loadSettings, saveSettings } from './settings'
import { clearSessions, loadSessions, saveSessions } from './sessions'
import { registerFileHandlers } from './files'
import { ensureCoreData, readCoreConfig, resolveCorePaths, saveCoreConfig } from './local-config.ts'
import { LocalCoreManager } from './local-core.ts'
import type { BackendConfig } from '../preload/api.ts'
import type { CoreConfig, CoreLogLine, CoreStatus } from '../shared/core-types.ts'

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


let localCore: LocalCoreManager | null = null
/** 本地核心的数据根（config.json、prompts、skills、微信凭证都在这下面） */
let coreDataDir = ''

/** 本地模式下自动接线的连接参数：地址与 token 都来自 core 的 config.json */
function localBackendTarget(): BackendConfig | null {
    if (!localCore || loadSettings().coreMode !== 'local') return null
    const cfg = readCoreConfig(coreDataDir)
    const port = typeof cfg.desktopPort === 'number' && Number.isFinite(cfg.desktopPort) ? cfg.desktopPort : 2147
    const token = typeof cfg.token === 'string' ? cfg.token : ''
    return { url: `ws://127.0.0.1:${port}`, token }
}

/** 按当前模式收敛消息通道目标；remote 模式交给渲染层 push 的手填配置 */
function reconcileBackendTarget(): void {
    const local = localBackendTarget()
    if (local) backend.apply(local)
}

function windowBackground(theme: string): string {
    return theme === 'light' ? '#f0e5cf' : '#191512'
}

function createWindow(): void {
    const win = new BrowserWindow({
        width: 1120,
        height: 740,
        minWidth: 940,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: windowBackground(loadSettings().theme),
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
    // ===== 本地内置核心 =====
    coreDataDir = join(app.getPath('userData'), 'core')
    const corePaths = resolveCorePaths(app.isPackaged, process.resourcesPath, resolve(import.meta.dirname, '../../../..', 'dist'))
    try {
        const created = ensureCoreData(corePaths.cwd, coreDataDir)
        if (created) console.log('本地核心数据目录已初始化:', coreDataDir)
    }
    catch (err) {
        // 播种失败只降级本地核心功能，不影响客户端其余部分
        console.warn('本地核心数据目录初始化失败:', err)
    }
    localCore = new LocalCoreManager({
        entry: corePaths.entry,
        cwd: corePaths.cwd,
        coreDataDir,
        getConfig: () => readCoreConfig(coreDataDir),
        handlers: {
            onStatus: (status: CoreStatus) => {
                for (const win of BrowserWindow.getAllWindows()) {
                    win.webContents.send('core:status', status)
                }
                // 本地核心就绪即按需接线消息通道；停止/崩溃交给 backend 的重连循环暴露状态
                if (status.state === 'running') reconcileBackendTarget()
            },
            onLog: (line: CoreLogLine) => {
                for (const win of BrowserWindow.getAllWindows()) {
                    win.webContents.send('core:log', line)
                }
            },
        },
    })

    ipcMain.handle('app:get-version', () => app.getVersion())
    ipcMain.handle('settings:get', () => loadSettings())
    ipcMain.handle('settings:save', (_e, raw: unknown) => {
        const saved = saveSettings(raw)
        applyLoginItem(saved.startAtLogin)
        // 窗口底色跟随主题，切换后立即刷新
        const bg = windowBackground(saved.theme)
        for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(bg)
        // 模式切换后收敛通道目标；remote 模式由渲染层随后推送手填配置
        reconcileBackendTarget()
        return saved
    })
    // 启动时对齐一次：设置文件可能被改过，或用户从系统设置里改过自启项
    applyLoginItem(loadSettings().startAtLogin)
    registerFileHandlers()
    ipcMain.handle('backend:get-status', () => backend.current())
    ipcMain.handle('backend:apply', (_e, raw: unknown) => {
        const local = localBackendTarget()
        if (local) {
            backend.apply(local)
            return
        }
        const config = asBackendConfig(raw)
        if (config) backend.apply(config)
    })
    // ===== 本地核心 IPC =====
    ipcMain.handle('core:get-status', () => localCore?.current() ?? { state: 'stopped' as const })
    ipcMain.handle('core:get-logs', () => localCore?.recentLogs(500) ?? [])
    ipcMain.handle('core:start', () => {
        if (!localCore) throw new Error('本地核心未初始化')
        localCore.start()
        return localCore.current()
    })
    ipcMain.handle('core:stop', async () => {
        if (!localCore) throw new Error('本地核心未初始化')
        await localCore.stop()
        return localCore.current()
    })
    ipcMain.handle('core:restart', async () => {
        if (!localCore) throw new Error('本地核心未初始化')
        await localCore.restart()
        return localCore.current()
    })
    ipcMain.handle('core:config:get', () => readCoreConfig(coreDataDir))
    ipcMain.handle('core:config:save', (_e, raw: unknown) => {
        // 形状守卫：patch 必须是普通对象，键值交给 deepMerge 与 core 侧的配置层校验
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            throw new Error('配置补丁必须是对象')
        }
        return saveCoreConfig(coreDataDir, raw as CoreConfig)
    })
    ipcMain.handle('core:open-config-dir', async () => {
        try {
            mkdirSync(coreDataDir, { recursive: true })
        }
        catch { /* 建不出来就让下面的 openPath 去报错 */ }
        const error = await shell.openPath(coreDataDir)
        if (!error) return
        console.warn('打开核心配置目录失败，改用在文件夹中显示:', error)
        const anchor = join(coreDataDir, 'config.json')
        if (!existsSync(anchor)) throw new Error(error)
        shell.showItemInFolder(anchor)
    })
    // 随应用启动本地核心（仅本地模式）
    if (loadSettings().coreMode === 'local' && loadSettings().coreAutoStart) {
        try {
            localCore.start()
        }
        catch (err) {
            console.warn('本地核心自动启动失败:', err)
        }
    }
    ipcMain.handle('backend:send', (_e, raw: unknown) => backend.send(raw))
    // 中断帧：不走消息管道，只让 core 停掉该对话进行中的一轮
    ipcMain.handle('backend:abort', (_e, raw: unknown) => {
        const req = (raw ?? {}) as { userId?: unknown; conversationId?: unknown }
        const userId = typeof req.userId === 'string' && req.userId.trim() !== '' ? req.userId.trim() : 'desktop'
        const conversationId =
            typeof req.conversationId === 'string' && req.conversationId !== '' ? req.conversationId : undefined
        return backend.send({ type: 'abort', userId, ...(conversationId ? { conversationId } : {}) })
    })
    ipcMain.handle('sessions:get', () => loadSessions())
    ipcMain.handle('sessions:save', (_e, raw: unknown) => saveSessions(raw))
    ipcMain.handle('sessions:clear', () => clearSessions())
    // 关窗前的补写走单向通道：退出路径上不等回执
    ipcMain.on('sessions:flush', (_e, raw: unknown) => saveSessions(raw))
    // 打开数据目录：会话快照、设置、日志都在这下面
    ipcMain.handle('system:open-data-dir', async () => {
        const dir = app.getPath('userData')
        // 目录还没建出来时先补一个：openPath 对不存在的路径只会返回一句莫名的错误
        try {
            mkdirSync(dir, { recursive: true })
        }
        catch { /* 建不出来就让下面的 openPath 去报错 */ }
        const error = await shell.openPath(dir)
        if (!error) return
        // openPath 被系统拒绝时退一步：在资源管理器里选中目录内已存在的文件，同样能到达该目录
        console.warn('打开数据目录失败，改用在文件夹中显示:', error)
        const anchor = [join(dir, 'settings.json'), join(dir, 'sessions.json')].find((p) => existsSync(p))
        if (!anchor) throw new Error(error)
        shell.showItemInFolder(anchor)
    })
    ipcMain.on('notify:reply', (_e, raw: unknown) => showReplyNotice(raw))
    // 测试通知：不看设置与窗口焦点，只回答「系统到底弹不弹」
    ipcMain.on('notify:test', () => {
        if (!Notification.isSupported()) return
        new Notification({ title: 'Cith', body: '通知链路正常：这是一条测试通知' }).show()
    })
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

// 退出前停掉本地核心（优雅停止有界，超时强杀），防止僵尸 core 进程
let quitting = false
app.on('before-quit', (event) => {
    if (!localCore || localCore.current().state === 'stopped' || quitting) return
    quitting = true
    event.preventDefault()
    void localCore.stop().then(() => app.quit())
})

/** 渲染层传来的配置做形状校验，不合形直接丢弃 */
function asBackendConfig(raw: unknown): BackendConfig | null {
    if (typeof raw !== 'object' || raw === null) return null
    const cfg = raw as Record<string, unknown>
    if (typeof cfg.url !== 'string' || typeof cfg.token !== 'string') return null
    return { url: cfg.url, token: cfg.token }
}

/** 开机自启：跟随设置项；开发态注册的是 electron 本体，打包后才有意义 */
function applyLoginItem(enabled: boolean): void {
    try {
        app.setLoginItemSettings({ openAtLogin: enabled })
    }
    catch (err) {
        console.warn('开机自启设置未生效:', err)
    }
}

/** 回复到达时弹系统通知：设置关闭、窗口在前台或内容为空都不打扰 */
function showReplyNotice(raw: unknown): void {
    if (!loadSettings().notifyOnReply) return
    if (!Notification.isSupported()) return
    if (BrowserWindow.getFocusedWindow()) return
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text === '') return
    new Notification({ title: 'Cith', body: text.slice(0, 160) }).show()
}
