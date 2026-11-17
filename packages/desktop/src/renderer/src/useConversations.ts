import { useEffect, useMemo, useState } from 'react'
import type { ChatMessage, Conversation, Segment, TraceData } from './types'
import { restoreSessions, snapshotOf } from './sessionSnapshot'
import { HISTORY_LIMIT_MAX } from '../../shared/settings.ts'

/** 落盘去抖：连发几条消息也只写一次 */
const SAVE_DEBOUNCE_MS = 500

let seq = 0
export function nextId() {
    seq += 1
    return `m${Date.now().toString(36)}-${seq}`
}

export function nowTime() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * 会话集合状态：列表 / 归档 / 激活会话及其增删改。
 * 会话只在本机缓存（userData/sessions.json），真源仍在 core 的记忆里；
 * 无主进程（dev:web）时放弃持久化，只在内存里跑。
 * 消息段在缝内按协议段构建：出站段数组从这里交出去，不做二次转换。
 * @param historyLimit 每条对话落盘保留的消息条数（设置页「会话」里可调）
 */
export function useConversations(historyLimit: number = HISTORY_LIMIT_MAX) {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [archived, setArchived] = useState<Conversation[]>([])
    const [activeId, setActiveId] = useState('')
    /** 恢复完成前不落盘：否则初始空列表会立刻把磁盘上的历史覆盖掉 */
    const [hydrated, setHydrated] = useState(() => !window.desktop?.getSessions)

    const active = conversations.find((c) => c.id === activeId) ?? conversations[0]

    // 启动时恢复上次的会话；文件缺失或损坏时保持空列表
    useEffect(() => {
        const api = window.desktop
        if (!api?.getSessions) return
        api.getSessions()
            .then((raw) => {
                const restored = restoreSessions(raw)
                if (!restored) return
                setConversations(restored.conversations)
                setArchived(restored.archived)
                setActiveId(restored.activeId)
            })
            .catch(() => {})
            .finally(() => setHydrated(true))
    }, [])

    // 快照每次状态变更构建一次，落盘与关窗补写共用
    const snapshot = useMemo(
        () => (hydrated ? snapshotOf({ conversations, archived, activeId }, historyLimit) : null),
        [hydrated, conversations, archived, activeId, historyLimit],
    )

    // 去抖落盘
    useEffect(() => {
        if (!snapshot || !window.desktop?.saveSessions) return
        const timer = window.setTimeout(() => {
            void window.desktop?.saveSessions?.(snapshot)
        }, SAVE_DEBOUNCE_MS)
        return () => window.clearTimeout(timer)
    }, [snapshot])

    // 关窗 / 刷新时补一次单向写：去抖窗口内的改动不至于丢
    useEffect(() => {
        if (!snapshot || !window.desktop?.flushSessions) return
        const flush = () => window.desktop?.flushSessions?.(snapshot)
        window.addEventListener('beforeunload', flush)
        window.addEventListener('pagehide', flush)
        return () => {
            window.removeEventListener('beforeunload', flush)
            window.removeEventListener('pagehide', flush)
        }
    }, [snapshot])

    function select(id: string) {
        setActiveId(id)
    }

    function create(): string {
        const conv: Conversation = {
            id: `c${Date.now().toString(36)}`,
            title: '新对话',
            updated: '刚刚',
            messages: [],
        }
        setConversations((list) => [conv, ...list])
        setActiveId(conv.id)
        return conv.id
    }

    /**
     * 发出的消息进列表并返回构建好的协议段（传输层直接搬运）；extras 是 Composer 构建的附件段，
     * 跟在文本后不做二次转换。纯附件消息允许没有文本；新对话的第一句话升级为标题。
     */
    function sendOutgoing(convId: string, text: string, extras: Segment[] = []): Segment[] {
        const segments: Segment[] = []
        if (text !== '') segments.push({ type: 'text', data: { text } })
        segments.push(...extras)
        setConversations((list) =>
            list.map((c) => {
                if (c.id !== convId) return c
                const title =
                    text !== '' && c.title === '新对话' ? (text.length > 18 ? `${text.slice(0, 18)}…` : text) : c.title
                return {
                    ...c,
                    title,
                    messages: [
                        ...c.messages,
                        { id: nextId(), role: 'user' as const, time: nowTime(), segments },
                    ],
                }
            }),
        )
        return segments
    }

    function appendMessage(convId: string, msg: ChatMessage) {
        setConversations((list) =>
            list.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg] } : c)),
        )
    }

    /** 更新指定会话最后一条消息里的工具痕迹（运行中 → 完成 等） */
    function updateLastTrace(convId: string, patch: Partial<TraceData>) {
        setConversations((list) =>
            list.map((c) => {
                if (c.id !== convId || c.messages.length === 0) return c
                const last = c.messages[c.messages.length - 1]
                const segs = last.segments
                for (let j = segs.length - 1; j >= 0; j--) {
                    const seg = segs[j]
                    if (seg.type === 'trace') {
                        const newSegs = [...segs]
                        newSegs[j] = { ...seg, data: { ...seg.data, ...patch } }
                        return {
                            ...c,
                            messages: [...c.messages.slice(0, -1), { ...last, segments: newSegs }],
                        }
                    }
                }
                return c
            }),
        )
    }

    /** 归档：从列表收起进归档组（可恢复） */
    function archive(id: string) {
        const target = conversations.find((c) => c.id === id)
        if (!target) return
        setConversations((list) => list.filter((c) => c.id !== id))
        setArchived((a) => [target, ...a])
        if (activeId === id) setActiveId(conversations.find((c) => c.id !== id)?.id ?? '')
    }

    /** 删除：直接移除；激活会话被移走时自动落到下一个 */
    function remove(id: string) {
        setConversations((list) => list.filter((c) => c.id !== id))
        if (activeId === id) setActiveId(conversations.find((c) => c.id !== id)?.id ?? '')
    }

    /** 从归档组恢复到列表顶部并激活 */
    function restore(id: string) {
        const target = archived.find((c) => c.id === id)
        if (!target) return
        setArchived((a) => a.filter((c) => c.id !== id))
        setConversations((list) => [target, ...list])
        setActiveId(id)
    }

    /** 清空本地记录：删掉快照文件，并把内存里的会话一起清掉 */
    function clearAll() {
        void window.desktop?.clearSessions?.().catch(() => {})
        setConversations([])
        setArchived([])
        setActiveId('')
    }

    return {
        conversations,
        archived,
        active,
        activeId,
        select,
        create,
        sendOutgoing,
        appendMessage,
        updateLastTrace,
        archive,
        remove,
        restore,
        clearAll,
    }
}

export type ConversationsStore = ReturnType<typeof useConversations>
