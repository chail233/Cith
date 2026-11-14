import { ipcRenderer, type IpcRendererEvent } from 'electron'

/** 消息通道连接状态（主进程 → 渲染层广播） */
export type BackendStatus = {
    state: 'idle' | 'connecting' | 'connected' | 'reconnecting'
    /** 最近一次失败的原因（重连中显示） */
    message?: string
}

/** 消息通道连接配置 */
export type BackendConfig = { url: string; token: string }

/** 占位协议帧段：统一段直传，正式协议定型后替换 */
export type FrameSegment = { type: string; data: Record<string, unknown> }

/** 出站消息帧：客户端 → core，身份由客户端随帧携带 */
export type OutgoingMessageFrame = {
    type: 'message'
    messageId: string
    userId: string
    segments: FrameSegment[]
}

/** 入站消息帧：core → 客户端，agent 回复按段逐帧推送 */
export type IncomingMessageFrame = {
    type: 'message'
    space: { from: string; id: string }
    segments: FrameSegment[]
}

/** 渲染层可用的主进程桥接 API，类型经 index.d.ts 暴露给 renderer */
export const desktopApi = {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
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
    /** 订阅入站消息帧；返回退订函数 */
    onMessage: (cb: (frame: IncomingMessageFrame) => void): (() => void) => {
        const listener = (_e: IpcRendererEvent, frame: IncomingMessageFrame): void => cb(frame)
        ipcRenderer.on('backend:message', listener)
        return () => {
            ipcRenderer.removeListener('backend:message', listener)
        }
    },
}

export type DesktopApi = typeof desktopApi
