import type { IncomingToolFrame } from '../../preload/api.ts'
import type { ChatMessage, TraceData } from './types.ts'

export function standaloneTrace(message: ChatMessage): TraceData | undefined {
    const [segment] = message.segments
    if (message.segments.length === 1 && segment?.type === 'trace') return segment.data
}

type TimelineEntry =
    | { type: 'message'; message: ChatMessage }
    | { type: 'tools'; id: string; rows: { id: string; data: TraceData }[] }

/** 相邻的工具调用共用一个折叠入口，按首个调用保留组标识。 */
export function groupToolTraces(timeline: ChatMessage[]): TimelineEntry[] {
    const entries: TimelineEntry[] = []
    for (const message of timeline) {
        const trace = standaloneTrace(message)
        if (!trace) {
            entries.push({ type: 'message', message })
            continue
        }
        const row = { id: message.id, data: trace }
        const previous = entries[entries.length - 1]
        if (previous?.type === 'tools') previous.rows.push(row)
        else entries.push({ type: 'tools', id: message.id, rows: [row] })
    }
    return entries
}

/** 按执行 ID 更新卡片。缺少开始帧时仍显示结束结果。 */
export function applyToolFrame(messages: ChatMessage[], frame: IncomingToolFrame, time: string): ChatMessage[] {
    const id = `tool:${frame.executionId}`
    const index = messages.findIndex((message) => message.id === id)
    if (index >= 0 && frame.type === 'tool.start') return messages

    const data: TraceData = { name: frame.toolName, summary: '', status: 'running' }
    if (frame.type === 'tool.end') {
        data.status = frame.status === 'returned' ? 'ok' : frame.status
        data.durationMs = frame.durationMs
        data.output = frame.output
    }
    const message: ChatMessage = {
        id,
        role: 'agent',
        time: messages[index]?.time ?? time,
        segments: [{ type: 'trace', data }],
    }
    if (index < 0) return [...messages, message]
    const updated = [...messages]
    updated[index] = message
    return updated
}

/** 断开连接后标出缺少结果的卡片，避免一直显示为执行中。 */
export function markUnconfirmedTools(messages: ChatMessage[]): ChatMessage[] {
    if (!messages.some((message) => standaloneTrace(message)?.status === 'running')) return messages
    return messages.map((message) => {
        const trace = standaloneTrace(message)
        if (trace?.status !== 'running') return message
        return { ...message, segments: [{ type: 'trace', data: { ...trace, status: 'unknown' } }] }
    })
}
