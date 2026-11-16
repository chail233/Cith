export type TraceStatus = 'ok' | 'error' | 'running'

/** trace 段的 data：演示期的展示段；协议接通后由缝里把 tool-* 事件转成它 */
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
 * trace 是桌面本地展示段，不进传输协议；image/file 的 base64 只存在于传输与渲染态，
 * core 落地后会重写成 media 引用。
 */
export type MediaSegmentData = {
    media?: { uri?: string; localPath?: string }
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
