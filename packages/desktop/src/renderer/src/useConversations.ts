import { useState } from 'react'
import type { ChatMessage, Conversation, Segment, TraceData } from './types'

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
 * 会话没有历史同步，从空开始；协议侧数据经 useBackendChat 进出，组件层不需要感知。
 * 消息段在缝内按协议段构建：出站段数组从这里交出去，不做二次转换。
 */
export function useConversations() {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [archived, setArchived] = useState<Conversation[]>([])
    const [activeId, setActiveId] = useState('')

    const active = conversations.find((c) => c.id === activeId) ?? conversations[0]

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

    /** 发出的消息进列表并返回构建好的协议段（传输层直接搬运）；新对话的第一句话升级为标题 */
    function sendOutgoing(convId: string, text: string): Segment[] {
        const segments: Segment[] = [{ type: 'text', data: { text } }]
        setConversations((list) =>
            list.map((c) => {
                if (c.id !== convId) return c
                const title = c.title === '新对话' ? (text.length > 18 ? `${text.slice(0, 18)}…` : text) : c.title
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
    }
}

export type ConversationsStore = ReturnType<typeof useConversations>
