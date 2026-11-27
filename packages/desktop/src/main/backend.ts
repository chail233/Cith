import { decodeDesktopBinaryFrame, encodeDesktopFrame, isDesktopMediaSegment } from '../../../core/utils/desktop-frame.ts'
import type { BackendConfig, BackendStatus, IncomingMessageFrame, IncomingToolFrame, OutgoingMessageFrame } from '../preload/api.ts'

/** 重连间隔上限 */
const RECONNECT_MAX_MS = 15_000
/** 建连超时：对端只建 TCP 不完成 WS 升级时也能回到重连节奏 */
const CONNECT_TIMEOUT_MS = 10_000
/** 配置变更的防抖窗口（连续下发合并为一次收敛） */
const APPLY_DEBOUNCE_MS = 400

/** 连接客户端的事件出口：状态变化与入站消息帧 */
export interface BackendHandlers {
    onStatus: (status: BackendStatus) => void
    onMessage: (frame: IncomingMessageFrame) => void
    onToolEvent: (frame: IncomingToolFrame) => void
}

/**
 * 消息通道连接客户端：桌面端与 core DesktopServer 之间的传输层，由主进程常驻持有。
 * 鉴权在握手阶段完成（Authorization: Bearer，与 core 的 extractToken 约定一致）；
 * 传输层只搬运占位协议的消息帧，断线自动指数重连。
 */
export class BackendConnection {
    private config: BackendConfig = { url: '', token: '' }
    private status: BackendStatus = { state: 'idle' }
    private ws: WebSocket | null = null
    /** 重连次数（成功清零），用于指数退避 */
    private attempt = 0
    /** 最近一次失败原因，重连中展示 */
    private lastError?: string
    private applyTimer: ReturnType<typeof setTimeout> | null = null
    private retryTimer: ReturnType<typeof setTimeout> | null = null
    private timeoutTimer: ReturnType<typeof setTimeout> | null = null

    private readonly handlers: BackendHandlers

    constructor(handlers: BackendHandlers) {
        this.handlers = handlers
    }

    /** 当前状态快照 */
    current(): BackendStatus {
        return this.status
    }

    /** 下发连接配置：防抖后按需重连；地址为空即回到未连接 */
    apply(config: BackendConfig): void {
        if (this.status.state === 'connected'
            && normalizeUrl(config.url) === normalizeUrl(this.config.url)
            && config.token.trim() === this.config.token.trim()) return
        this.config = config
        if (this.applyTimer) clearTimeout(this.applyTimer)
        this.applyTimer = setTimeout(() => {
            this.applyTimer = null
            this.reconcile()
        }, APPLY_DEBOUNCE_MS)
    }

    /** 发送一条消息帧；未连接时返回 false */
    send(frame: unknown): boolean {
        const ws = this.ws
        if (!ws || ws.readyState !== WebSocket.OPEN) return false
        try {
            ws.send(encodeOutgoingFrame(frame))
            return true
        }
        catch {
            return false
        }
    }

    /** 按当前配置收敛到目标状态 */
    private reconcile(): void {
        this.clearRetry()
        if (!this.config.url.trim()) {
            this.closeSocket()
            this.attempt = 0
            this.lastError = undefined
            this.setStatus({ state: 'idle' })
            return
        }
        this.attempt = 0
        this.lastError = undefined
        this.open()
    }

    private open(): void {
        this.closeSocket()
        const url = normalizeUrl(this.config.url)
        if (!url) {
            this.setStatus({ state: 'idle' })
            return
        }
        const token = this.config.token.trim()
        let ws: WebSocket
        try {
            ws = new WebSocket(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
        }
        catch {
            // 地址语法无效（残缺冒号/越界端口等）时构造器同步抛错，不接住会炸掉主进程
            this.lastError = '地址格式无效——检查服务器地址'
            this.setStatus({ state: 'idle', message: this.lastError })
            return
        }
        this.ws = ws
        ws.binaryType = 'arraybuffer'
        this.setStatus(this.attempt === 0 ? { state: 'connecting' } : { state: 'reconnecting', message: this.lastError })

        ws.onopen = () => {
            if (this.ws !== ws) return
            this.clearTimeoutTimer()
            this.attempt = 0
            this.lastError = undefined
            this.setStatus({ state: 'connected' })
        }
        ws.onmessage = (ev) => {
            if (this.ws !== ws) return
            let frame: IncomingMessageFrame | IncomingToolFrame | null
            try {
                frame = typeof ev.data === 'string'
                    ? parseTextFrame(ev.data)
                    : ev.data instanceof ArrayBuffer ? parseMessageFrame(decodeDesktopBinaryFrame(Buffer.from(ev.data))) : null
            }
            catch {
                return
            }
            if (frame?.type === 'message') this.handlers.onMessage(frame)
            else if (frame) this.handlers.onToolEvent(frame)
        }
        ws.onclose = (ev) => {
            if (this.ws !== ws) return
            this.ws = null
            this.clearTimeoutTimer()
            this.lastError ||= describeClose(ev.code)
            this.attempt += 1
            this.setStatus({ state: 'reconnecting', message: this.lastError })
            this.scheduleRetry()
        }
        // 握手被拒（401 等）时 undici 会先抛 error 事件，能拿到细节就翻译成人话
        ws.onerror = (ev) => {
            if (this.ws !== ws) return
            const detail = ev.message || (ev as unknown as { error?: { message?: string } }).error?.message || ''
            if (/401|403|unauthorized/i.test(detail)) this.lastError = '鉴权失败——检查设置里的 token'
        }
        // 建连超时兜底：主动断掉卡死的连接，走 onclose 重连
        this.timeoutTimer = setTimeout(() => {
            if (this.ws !== ws) return
            this.lastError = '连接超时'
            try { ws.close() } catch { /* ignore */ }
        }, CONNECT_TIMEOUT_MS)
    }

    private scheduleRetry(): void {
        this.clearRetry()
        const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** Math.min(this.attempt - 1, 4))
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            this.open()
        }, delay)
    }

    /** 主动断开当前 socket；其 close 回调里按引用守卫被忽略 */
    private closeSocket(): void {
        this.clearTimeoutTimer()
        const ws = this.ws
        this.ws = null
        if (!ws) return
        try { ws.close() } catch { /* ignore */ }
    }

    private clearRetry(): void {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer)
            this.retryTimer = null
        }
    }

    private clearTimeoutTimer(): void {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer)
            this.timeoutTimer = null
        }
    }

    private setStatus(status: BackendStatus): void {
        this.status = status
        this.handlers.onStatus(status)
    }
}

/** 宽容解析地址：缺协议头时补 ws:// */
function normalizeUrl(raw: string): string {
    const url = raw.trim()
    if (!url) return ''
    return /^wss?:\/\//i.test(url) ? url : `ws://${url}`
}

/** 关闭码翻成给用户看的短语 */
function describeClose(code: number): string {
    if (code === 1006) return '无法建立连接（地址不通或服务未启动）'
    if (code === 1008) return '被服务端拒绝'
    return `连接关闭（代码 ${code}）`
}

function parseTextFrame(json: string): IncomingMessageFrame | IncomingToolFrame | null {
    const payload: unknown = JSON.parse(json)
    return parseMessageFrame(payload) ?? parseToolFrame(payload)
}

function parseMessageFrame(payload: unknown): IncomingMessageFrame | null {
    const frame = payload as Partial<IncomingMessageFrame> | null
    if (frame?.type !== 'message' || !frame.space || typeof frame.space !== 'object'
        || !Array.isArray(frame.segments) || !frame.segments.every((seg) => typeof seg?.type === 'string')) return null
    for (const segment of frame.segments) {
        if (!isDesktopMediaSegment(segment.type) || !segment.data) continue
        const { bytes, base64, ...data } = segment.data
        if (Buffer.isBuffer(bytes)) segment.data = { ...data, bytes: Uint8Array.from(bytes).buffer }
        else if (base64 !== undefined) segment.data = data
    }
    return frame as IncomingMessageFrame
}

function parseToolFrame(payload: unknown): IncomingToolFrame | null {
    const frame = payload as Partial<IncomingToolFrame> | null
    if (frame?.type !== 'tool.start' && frame?.type !== 'tool.end') return null
    if (typeof frame.space?.id !== 'string' || typeof frame.space.conversationId !== 'string' || !frame.space.conversationId
        || typeof frame.executionId !== 'string' || !frame.executionId || typeof frame.toolCallId !== 'string'
        || typeof frame.toolName !== 'string' || !frame.toolName || !Number.isFinite(frame.startedAt)) return null
    if (frame.type === 'tool.end') {
        if (frame.status !== 'returned' && frame.status !== 'error' && frame.status !== 'timeout' && frame.status !== 'aborted') return null
        if (typeof frame.output !== 'string' || !Number.isFinite(frame.durationMs)) return null
    }
    return frame as IncomingToolFrame
}

/** 上传图片在 WebSocket 边界编码，其他附件直接随帧传输原始字节。 */
function encodeOutgoingFrame(raw: unknown): string | Buffer {
    const frame = raw as Partial<OutgoingMessageFrame> | null
    if (frame?.type !== 'message' || !Array.isArray(frame.segments)) return JSON.stringify(raw)

    const payloads: Buffer[] = []
    const segments = frame.segments.map((segment) => {
        if (!isDesktopMediaSegment(segment.type) || !segment.data) return segment
        const { bytes, base64: _base64, ...data } = segment.data
        if (!(bytes instanceof ArrayBuffer)) return { ...segment, data }
        const buffer = Buffer.from(bytes)
        if (segment.type === 'image') return { ...segment, data: { ...data, base64: buffer.toString('base64') } }
        payloads.push(buffer)
        return { ...segment, data: { ...data, binaryLength: buffer.byteLength } }
    })
    return encodeDesktopFrame({ ...frame, segments }, payloads)
}
