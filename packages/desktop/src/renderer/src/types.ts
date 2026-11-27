export type TraceStatus = 'ok' | 'error' | 'running' | 'timeout' | 'aborted' | 'unknown'

/** 由工具执行事件生成，随桌面会话保存。 */
export type TraceData = {
    name: string
    summary: string
    status: TraceStatus
    durationMs?: number
    command?: string
    output?: string
}

/**
 * 协议消息段：与 core 统一段同构（{type, data}），只在数据缝内构建，渲染层按 type 分支。
 * trace 是桌面本地展示段，不进传输协议；收到的二进制图片在渲染态保留原始字节。
 */
export type MediaSegmentData = {
    media?: { uri?: string; localPath?: string }
    bytes?: ArrayBuffer
    base64?: string
    mime?: string
    name?: string
    size?: number
}

export type Segment =
    | { type: 'text'; data: { text: string } }
    | { type: 'image'; data: MediaSegmentData }
    | { type: 'file'; data: MediaSegmentData }
    | { type: 'trace'; data: TraceData }

export type ChatMessage = {
    id: string
    role: 'user' | 'agent'
    time: string
    segments: Segment[]
}

export type Conversation = {
    id: string
    title: string
    updated: string
    messages: ChatMessage[]
}
