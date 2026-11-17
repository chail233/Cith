import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { CoreConfig, CoreLogLine, CoreStatus, CoreState } from '../shared/core-types.ts'

/**
 * 本地内置 core 的进程管理器：
 * 以 ELECTRON_RUN_AS_NODE 方式复用 Electron 自带的 Node 跑编译产物，不要求系统安装 Node
 * 只负责「进程」——启动参数、日志缓冲、状态广播、优雅停止；配置文件由 local-config 管理。
 */

export type { CoreState, CoreStatus, CoreLogLine } from '../shared/core-types.ts'

export interface LocalCoreHandlers {
    onStatus: (status: CoreStatus) => void
    onLog: (line: CoreLogLine) => void
}

export interface LocalCoreOptions {
    entry: string
    cwd: string
    coreDataDir: string
    getConfig: () => CoreConfig
    handlers: LocalCoreHandlers
}

const LOG_BUFFER_LIMIT = 2000
const SHUTDOWN_GRACE_MS = 4000
const SHUTDOWN_API_TIMEOUT_MS = 2000
const STARTUP_STABLE_MS = 1500

export class LocalCoreManager {
    private child: ChildProcess | null = null
    private state: CoreState = 'stopped'
    private exitCode: number | null = null
    private startedAt = 0
    private message?: string
    /** 主动停止标记：区分「用户停止」与「进程崩溃」 */
    private stopping = false
    private logs: CoreLogLine[] = []
    private stdoutRemainder = ''
    private stderrRemainder = ''

    private readonly opts: LocalCoreOptions

    constructor(opts: LocalCoreOptions) {
        this.opts = opts
    }

    current(): CoreStatus {
        return {
            state: this.state,
            pid: this.child?.pid,
            exitCode: this.exitCode,
            startedAt: this.startedAt || undefined,
            message: this.message,
        }
    }

    /** 日志缓冲快照（最多 count 行，取尾部） */
    recentLogs(count = 500): CoreLogLine[] {
        return this.logs.slice(-count)
    }

    isRunning(): boolean {
        return this.state === 'starting' || this.state === 'running'
    }


    start(): void {
        if (this.child) throw new Error('本地核心已在运行')
        this.exitCode = null
        this.message = undefined
        this.stopping = false
        this.setState({ state: 'starting' })

        let child: ChildProcess
        try {
            child = spawn(process.execPath, [this.opts.entry], {
                // ELECTRON_RUN_AS_NODE 让 Electron 本体以纯 Node 运行 core 编译产物
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    CITH_CONFIG: join(this.opts.coreDataDir, 'config.json'),
                    CITH_DATA: this.opts.coreDataDir,
                },
                cwd: this.opts.cwd,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            })
        }
        catch (err) {
            this.message = err instanceof Error ? err.message : String(err)
            this.setState({ state: 'stopped', message: this.message })
            return
        }
        this.child = child
        this.startedAt = Date.now()
        this.stdoutRemainder = ''
        this.stderrRemainder = ''
        this.pushLog({ ts: Date.now(), text: `[本地核心] 正在启动（pid ${child.pid}）` })

        // 稳定存活计时：活着过 STARTUP_STABLE_MS 才报 running
        const stableTimer = setTimeout(() => {
            if (this.child === child && this.state === 'starting') {
                this.setState({ state: 'running', pid: child.pid })
            }
        }, STARTUP_STABLE_MS)
        stableTimer.unref?.()

        child.stdout?.on('data', (chunk: Buffer) => this.feedLines(String(chunk), 'stdout'))
        child.stderr?.on('data', (chunk: Buffer) => this.feedLines(String(chunk), 'stderr'))

        child.on('error', (err) => {
            // spawn 失败（入口不存在等）：error 事件后紧跟 exit，这里只记原因
            this.message = err.message
            this.pushLog({ ts: Date.now(), text: `[本地核心] 启动失败: ${err.message}` })
        })

        child.on('exit', (code) => {
            if (this.child !== child) return
            this.child = null
            this.exitCode = code
            this.flushRemainders()
            if (this.stopping) {
                this.setState({ state: 'stopped', exitCode: code })
            }
            else {
                this.message = `进程意外退出（代码 ${code ?? '未知'}）`
                this.pushLog({ ts: Date.now(), text: `[本地核心] ${this.message}` })
                this.setState({ state: 'crashed', exitCode: code, message: this.message })
            }
        })
    }

    /** 停止：先请求 API 优雅退出（保留 core 的清理链），超时强杀；等待进程退出后返回 */
    async stop(): Promise<void> {
        const child = this.child
        if (!child) return
        this.stopping = true
        this.setState({ state: 'stopping', pid: child.pid })
        void requestApiShutdown(this.opts.getConfig())

        await new Promise<void>((resolveExit) => {
            const timer = setTimeout(() => {
                try { child.kill() } catch { /* 进程已死时不致死 */ }
                resolveExit()
            }, SHUTDOWN_GRACE_MS)
            child.once('exit', () => {
                clearTimeout(timer)
                resolveExit()
            })
        })
    }

    async restart(): Promise<void> {
        await this.stop()
        this.start()
    }

    private setState(patch: Partial<CoreStatus> & { state: CoreState }): void {
        this.state = patch.state
        this.opts.handlers.onStatus({
            state: this.state,
            pid: this.child?.pid,
            exitCode: this.exitCode,
            startedAt: this.startedAt || undefined,
            message: this.message,
        })
    }

    /** 按行拆分流数据并入环形缓冲；残行留待下一块或退出时补齐 */
    private feedLines(chunk: string, _stream: 'stdout' | 'stderr'): void {
        const key = _stream === 'stdout' ? 'stdoutRemainder' : 'stderrRemainder'
        this[key] += chunk
        const lines = this[key].split('\n')
        this[key] = lines.pop() ?? ''
        for (const line of lines) this.pushLog({ ts: Date.now(), text: line })
    }

    private flushRemainders(): void {
        for (const rest of [this.stdoutRemainder, this.stderrRemainder]) {
            if (rest.trim() !== '') this.pushLog({ ts: Date.now(), text: rest })
        }
        this.stdoutRemainder = ''
        this.stderrRemainder = ''
    }

    private pushLog(line: CoreLogLine): void {
        this.logs.push(line)
        if (this.logs.length > LOG_BUFFER_LIMIT) this.logs.splice(0, this.logs.length - LOG_BUFFER_LIMIT)
        this.opts.handlers.onLog(line)
    }
}


function requestApiShutdown(config: CoreConfig): Promise<boolean> {
    const web = (typeof config.web === 'object' && config.web !== null ? config.web : {}) as Record<string, unknown>
    const port = typeof web.port === 'number' && Number.isFinite(web.port) ? web.port : 2145
    const path = typeof web.path === 'string' && web.path.trim() !== '' ? web.path : '/api/v1/ws'
    const token = typeof web.token === 'string' ? web.token : ''

    return new Promise((resolve) => {
        let ws: WebSocket
        try {
            ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
        }
        catch {
            resolve(false)
            return
        }
        let settled = false
        const finish = (ok: boolean): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            try { ws.close() } catch { /* ignore */ }
            resolve(ok)
        }
        const timer = setTimeout(() => finish(false), SHUTDOWN_API_TIMEOUT_MS)
        ws.onopen = () => {
            ws.send(JSON.stringify({ id: 'cith-shutdown-auth', action: 'auth', token }))
        }
        ws.onmessage = (ev) => {
            let frame: unknown
            try {
                frame = JSON.parse(String(ev.data))
            }
            catch {
                return
            }
            const id = (frame as { id?: unknown }).id
            const status = (frame as { status?: unknown }).status
            if (id === 'cith-shutdown-auth') {
                if (status === 'ok') ws.send(JSON.stringify({ id: 'cith-shutdown', action: 'shutdown' }))
                else finish(false)
            }
            else if (id === 'cith-shutdown') {
                finish(status === 'ok')
            }
        }
        ws.onclose = () => finish(false)
        ws.onerror = () => finish(false)
    })
}
