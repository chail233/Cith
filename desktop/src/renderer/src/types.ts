export type TraceStatus = 'ok' | 'error' | 'running'

export type ToolTrace = {
    kind: 'trace'
    name: string
    summary: string
    status: TraceStatus
    durationMs?: number
    command?: string
    output?: string
}

export type Segment = { kind: 'text'; text: string } | ToolTrace

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
