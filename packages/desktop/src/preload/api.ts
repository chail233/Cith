import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { UiSettings } from '../shared/settings.ts'
import type { PersistedSessions } from '../shared/session.ts'

/** 消息通道连接状态（主进程 → 渲染层广播） */
export type BackendStatus = {
    state: 'idle' | 'connecting' | 'connected' | 'reconnecting'
    /** 最近一次失败的原因（重连中或地址无效时显示） */
    message?: string
}

/** 消息通道连接配置 */
export type BackendConfig = { url: string; token: string }

/** 选取的本地文件：内容已读成 base64，kind 标记它来自哪个选择对话框 */
export type PickedFile = {
    kind: 'image' | 'file'
    name: string
    path: string
    mime: string
    size: number
    base64: string
}

/** 占位协议帧段：统一段直传，正式协议定型后替换 */
export type FrameSegment = { type: string; data: Record<string, unknown> }

/** 出站消息帧：客户端 → core，身份由客户端随帧携带 */
export type OutgoingMessageFrame = {
    type: 'message'
    messageId: string
    userId: string
    conversationId: string
    segments: FrameSegment[]
}

/** 入站消息帧：core → 客户端，agent 回复按段逐帧推送 */
export type IncomingMessageFrame = {
    type: 'message'
    space: { from: string; id: string; conversationId?: string }
    segments: FrameSegment[]
}

/** 中断请求：会话归属与消息帧同一套规则 */
export type AbortRequest = { userId: string; conversationId?: string }

/** 渲染层可用的主进程桥接 API，类型经 index.d.ts 暴露给 renderer */
export const desktopApi = {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    /** 当前生效的设置；主进程从配置文件懒加载 */
    getSettings: (): Promise<UiSettings> => ipcRenderer.invoke('settings:get'),
    /** 保存设置并落盘配置文件，返回合并默认值后的生效状态 */
    saveSettings: (s: UiSettings): Promise<UiSettings> => ipcRenderer.invoke('settings:save', s),
    /** 当前消息通道连接状态 */
    getBackendStatus: (): Promise<BackendStatus> => ipcRenderer.invoke('backend:get-status'),
    /** 下发连接配置；主进程防抖后按需重连 */
    setBackend: (config: BackendConfig): Promise<void> => ipcRenderer.invoke('backend:apply', config),
    /** 订阅连接状态变化；返回退订函数 */
    onBackendStatus: (cb: (status: BackendStatus) => void): (() => void) => {
        const listener = (_e: IpcRendererEvent, status: BackendStatus): void => cb(status)
        ipcRenderer.on('backend:status', listener)
        return () => {
            ipcRenderer.removeListener('backend:status', listener)
        }
    },
    /** 发送一条消息帧；返回是否已交付传输层（未连接时为 false） */
    sendMessage: (frame: OutgoingMessageFrame): Promise<boolean> => ipcRenderer.invoke('backend:send', frame),
    /** 中断该对话进行中的一轮；返回是否已交付传输层 */
    abort: (request: AbortRequest): Promise<boolean> => ipcRenderer.invoke('backend:abort', request),
    /** 读取落盘的会话快照；无文件或文件损坏时为 null */
    getSessions: (): Promise<PersistedSessions | null> => ipcRenderer.invoke('sessions:get'),
    /** 写入会话快照；形状不合或超出体积上限时主进程直接丢弃 */
    saveSessions: (snapshot: PersistedSessions): Promise<void> => ipcRenderer.invoke('sessions:save', snapshot),
    /** 关窗前的补写：单向发送，不等回执 */
    flushSessions: (snapshot: PersistedSessions): void => {
        ipcRenderer.send('sessions:flush', snapshot)
    },
    /** 订阅入站消息帧；返回退订函数 */
    onMessage: (cb: (frame: IncomingMessageFrame) => void): (() => void) => {
        const listener = (_e: IpcRendererEvent, frame: IncomingMessageFrame): void => cb(frame)
        ipcRenderer.on('backend:message', listener)
        return () => {
            ipcRenderer.removeListener('backend:message', listener)
        }
    },
    /** 弹出文件/图片选择对话框，选中内容读成 base64 返回 */
    pickFiles: (kind: 'image' | 'file'): Promise<PickedFile[]> => ipcRenderer.invoke('dialog:pick', kind),
    /** 保存收到的文件：弹保存对话框，返回最终路径；取消为 null */
    saveFile: (name: string, base64: string): Promise<string | null> =>
        ipcRenderer.invoke('file:save', { name, base64 }),
    /** 用系统默认程序打开 http(s) 链接 */
    openExternal: (uri: string): Promise<void> => ipcRenderer.invoke('file:open-external', uri),
}

export type DesktopApi = typeof desktopApi
