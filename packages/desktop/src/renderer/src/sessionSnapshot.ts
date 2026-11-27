import type { ChatMessage, Conversation, MediaSegmentData, Segment, TraceData, TraceStatus, VoiceSegmentData } from './types'
import { SESSIONS_VERSION, type PersistedSessions } from '../../shared/session.ts'
import { HISTORY_LIMIT_MAX, HISTORY_LIMIT_MIN } from '../../shared/settings.ts'

/** 会话条数上限（列表 + 归档各自） */
const MAX_CONVERSATIONS = 200
/** 单段 base64 的体积上限：超出只留元信息，重启后显示未缓存占位 */
const MAX_SEGMENT_BASE64 = 1536 * 1024
/** 快照随会话状态反复生成，同一段媒体只编码一次 */
const snapshotMedia = new WeakMap<ArrayBuffer, string>()

const TRACE_STATUSES: TraceStatus[] = ['ok', 'error', 'running', 'timeout', 'aborted', 'unknown']

type SnapshotState = { conversations: Conversation[]; archived: Conversation[]; activeId: string }


function clampLimit(limit: number): number {
    if (!Number.isFinite(limit)) return HISTORY_LIMIT_MAX
    return Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.round(limit)))
}


export function snapshotOf(
    { conversations, archived, activeId }: SnapshotState,
    historyLimit: number = HISTORY_LIMIT_MAX,
): PersistedSessions {
    const limit = clampLimit(historyLimit)
    return {
        version: SESSIONS_VERSION,
        conversations: conversations.slice(0, MAX_CONVERSATIONS).map((conv) => snapshotConversation(conv, limit)),
        archived: archived.slice(0, MAX_CONVERSATIONS).map((conv) => snapshotConversation(conv, limit)),
        activeId,
    }
}

function snapshotConversation(conv: Conversation, limit: number): Conversation {
    return {
        id: conv.id,
        title: conv.title,
        updated: conv.updated,
        messages: conv.messages.slice(-limit).map((msg) => ({
            id: msg.id,
            role: msg.role,
            time: msg.time,
            segments: msg.segments.map(snapshotSegment),
        })),
    }
}

function snapshotSegment(seg: Segment): Segment {
    if (seg.type !== 'image' && seg.type !== 'file' && seg.type !== 'voice') return seg
    const { bytes, ...data } = seg.data
    if (bytes) {
        const fits = Math.ceil(bytes.byteLength / 3) * 4 <= MAX_SEGMENT_BASE64
        return { type: seg.type, data: { ...data, base64: fits ? encodeSnapshotMedia(bytes) : undefined } }
    }
    if (!data.base64 || data.base64.length <= MAX_SEGMENT_BASE64) return seg
    return { type: seg.type, data: { ...data, base64: undefined } }
}

function encodeSnapshotMedia(buffer: ArrayBuffer): string {
    const cached = snapshotMedia.get(buffer)
    if (cached !== undefined) return cached

    const bytes = new Uint8Array(buffer)
    const chunkSize = 8192
    let binary = ''
    for (let start = 0; start < bytes.length; start += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize))
    }
    const base64 = btoa(binary)
    snapshotMedia.set(buffer, base64)
    return base64
}

/**
 * 校验并还原快照；外层形状不合法时返回 null（按空会话起步）
 * @returns 会话列表、归档列表与激活会话（激活项失效时回落到第一个）
 */
export function restoreSessions(raw: unknown): SnapshotState | null {
    if (typeof raw !== 'object' || raw === null) return null
    const snap = raw as Partial<PersistedSessions>
    if (!Array.isArray(snap.conversations) || !Array.isArray(snap.archived)) return null

    const conversations = uniqueById(snap.conversations.map(toConversation).filter(notNull)).slice(0, MAX_CONVERSATIONS)
    const archived = uniqueById(snap.archived.map(toConversation).filter(notNull)).slice(0, MAX_CONVERSATIONS)
    const wanted = typeof snap.activeId === 'string' ? snap.activeId : ''
    const activeId = conversations.some((c) => c.id === wanted) ? wanted : (conversations[0]?.id ?? '')
    return { conversations, archived, activeId }
}

function toConversation(raw: unknown): Conversation | null {
    if (typeof raw !== 'object' || raw === null) return null
    const conv = raw as Partial<Conversation>
    if (typeof conv.id !== 'string' || conv.id === '') return null
    const messages = Array.isArray(conv.messages) ? conv.messages.map(toMessage).filter(notNull) : []
    return {
        id: conv.id,
        title: typeof conv.title === 'string' && conv.title !== '' ? conv.title : '新对话',
        updated: typeof conv.updated === 'string' ? conv.updated : '刚刚',
        messages: messages.slice(-clampLimit(HISTORY_LIMIT_MAX)),
    }
}

function toMessage(raw: unknown): ChatMessage | null {
    if (typeof raw !== 'object' || raw === null) return null
    const msg = raw as Partial<ChatMessage>
    if (typeof msg.id !== 'string' || msg.id === '') return null
    if (msg.role !== 'user' && msg.role !== 'agent') return null
    const segments = Array.isArray(msg.segments) ? msg.segments.map(toSegment).filter(notNull) : []
    // 没有可渲染段的空消息没有留存价值
    if (segments.length === 0) return null
    return {
        id: msg.id,
        role: msg.role,
        time: typeof msg.time === 'string' ? msg.time : '',
        segments,
    }
}

function toSegment(raw: unknown): Segment | null {
    if (typeof raw !== 'object' || raw === null) return null
    const seg = raw as { type?: unknown; data?: unknown }
    if (typeof seg.type !== 'string') return null
    const data = (typeof seg.data === 'object' && seg.data !== null ? seg.data : {}) as Record<string, unknown>

    if (seg.type === 'text') {
        return typeof data.text === 'string' ? { type: 'text', data: { text: data.text } } : null
    }
    if (seg.type === 'image' || seg.type === 'file' || seg.type === 'voice') {
        const media = toMedia(data.media)
        const base64 = typeof data.base64 === 'string' && data.base64 !== '' ? data.base64 : undefined
        const name = typeof data.name === 'string' ? data.name : ''
        const text = seg.type === 'voice' && typeof data.text === 'string' ? data.text : ''
        if (!media && !base64 && name === '' && text === '') return null
        const out: VoiceSegmentData = { ...(media ? { media } : {}), ...(base64 ? { base64 } : {}) }
        if (typeof data.mime === 'string') out.mime = data.mime
        if (name !== '') out.name = name
        if (typeof data.size === 'number' && Number.isFinite(data.size)) out.size = data.size
        if (text !== '') out.text = text
        return { type: seg.type, data: out }
    }
    if (seg.type === 'trace') {
        const trace = toTrace(data)
        return trace ? { type: 'trace', data: trace } : null
    }
    return null
}

function toMedia(raw: unknown): MediaSegmentData['media'] {
    if (typeof raw !== 'object' || raw === null) return undefined
    const media = raw as { uri?: unknown; localPath?: unknown }
    const uri = typeof media.uri === 'string' ? media.uri : ''
    const localPath = typeof media.localPath === 'string' ? media.localPath : ''
    if (!uri && !localPath) return undefined
    return { ...(uri ? { uri } : {}), ...(localPath ? { localPath } : {}) }
}

function toTrace(data: Record<string, unknown>): TraceData | null {
    if (typeof data.name !== 'string' || data.name === '') return null
    const status = TRACE_STATUSES.find((s) => s === data.status)
    if (!status) return null
    return {
        name: data.name,
        summary: typeof data.summary === 'string' ? data.summary : '',
        status: status === 'running' ? 'unknown' : status,
        ...(typeof data.durationMs === 'number' ? { durationMs: data.durationMs } : {}),
        ...(typeof data.command === 'string' ? { command: data.command } : {}),
        ...(typeof data.output === 'string' ? { output: data.output } : {}),
    }
}

/** 去掉重复 id：同 id 会话在 React 列表里会互相顶掉 */
function uniqueById(list: Conversation[]): Conversation[] {
    const seen = new Set<string>()
    return list.filter((conv) => {
        if (seen.has(conv.id)) return false
        seen.add(conv.id)
        return true
    })
}

function notNull<T>(value: T | null): value is T {
    return value !== null
}
