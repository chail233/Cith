import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage, Conversation, Segment } from '../types'
import type { UiSettings } from '../../../shared/settings'
import { Avatar } from './Avatar'
import { BrandMark } from '@cith/ui'
import { Message } from './Message'
import { Composer } from './Composer'
import { ToolTrace, ToolTraceGroup } from './ToolTrace'
import { groupTimeline, standaloneTrace } from '../toolTraces'
import './Chat.css'

type Props = {
    conversation?: Conversation
    pending: boolean
    connected: boolean
    settings: UiSettings
    onSend: (text: string, extras: Segment[]) => void
    onStop: () => void
}

export function ChatArea({ conversation, pending, connected, settings, onSend, onStop }: Props) {
    const messages = settings.showToolCalls
        ? conversation?.messages
        : conversation?.messages.filter((message) => message.segments.some((segment) => segment.type !== 'trace'))
    return (
        <main className="chat">
            <header className="chat-head">
                <div className="chat-head-drag" aria-hidden="true" />
                <div className="chat-rail">
                    {conversation && <h1 className="chat-title">{conversation.title}</h1>}
                </div>
            </header>

            {messages?.length ? (
                <MessageList messages={messages} pending={pending} settings={settings} />
            ) : (
                <EmptyState settings={settings} hasConversation={Boolean(conversation)} />
            )}

            {conversation && (
                <Composer
                    onSend={onSend}
                    onStop={onStop}
                    disabled={!connected}
                    pending={pending}
                    sendKey={settings.sendKey}
                    hint={connected ? undefined : '未连接后端，消息无法送达 · 前往设置配置连接'}
                />
            )}
        </main>
    )
}

function MessageList({ messages: timeline, pending, settings }: { messages: ChatMessage[]; pending: boolean; settings: UiSettings }) {
    const ref = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const scrollBottom = useRef<number | null>(null)
    // 工具卡片即刻展示，只有聊天回复参与拟人节奏。
    const messages = timeline.filter((message) => !standaloneTrace(message))
    const hasRunningTools = timeline.some((message) => standaloneTrace(message)?.status === 'running')

    // 刚进入会话时历史全部可见。游标只控制本次查看期间新增回复的展示。
    const [cursor, setCursor] = useState({ message: messages.length, segment: 0 })
    const instant = !settings.pacedReplies || messages[messages.length - 1]?.role === 'user'
    const shown = instant ? messages.length : cursor.message
    const next = messages[shown]
    const segment = next?.segments[cursor.segment]
    const visible = new Map(messages.slice(0, shown).map((message) => [message.id, message]))
    if (next && cursor.segment > 0) {
        visible.set(next.id, { ...next, segments: next.segments.slice(0, cursor.segment) })
    }

    useEffect(() => {
        if (instant) {
            if (cursor.message !== shown) setCursor({ message: shown, segment: 0 })
            return
        }
        if (!next) return
        if (next.role === 'user' || !segment) {
            setCursor({ message: shown + 1, segment: 0 })
            return
        }
        const delay = segment.type === 'text' ? Math.min(2400, 450 + segment.data.text.length * 35) : 650
        const timer = window.setTimeout(() => {
            setCursor(cursor.segment + 1 === next.segments.length
                ? { message: shown + 1, segment: 0 }
                : { message: shown, segment: cursor.segment + 1 })
        }, delay)
        return () => window.clearTimeout(timer)
    }, [instant, next, segment, shown, cursor])

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        // 历史消息在首帧绘制前直接定位到底部，后续更新沿用滚动样式。
        const bottom = el.scrollHeight - el.clientHeight
        el.scrollTo({ top: bottom, behavior: scrollBottom.current === null ? 'instant' : 'auto' })
        scrollBottom.current = bottom
    }, [shown, cursor.segment, pending, next, timeline.length])

    useLayoutEffect(() => {
        const el = ref.current
        const content = contentRef.current
        if (!el || !content) return
        const observer = new ResizeObserver(() => {
            const previousBottom = scrollBottom.current
            const bottom = el.scrollHeight - el.clientHeight
            scrollBottom.current = bottom
            // 图片撑高历史列表时，仍在底部的视口继续贴底。
            if (previousBottom !== null && bottom > previousBottom && el.scrollTop >= previousBottom - 1) {
                el.scrollTo({ top: bottom, behavior: 'instant' })
            }
        })
        observer.observe(content)
        return () => observer.disconnect()
    }, [])

    return (
        <div className="msgs" ref={ref}>
            <div className="msgs-col chat-rail" ref={contentRef}>
                {groupTimeline(timeline, !settings.pacedReplies).map((entry) => {
                    if (entry.type === 'tools') return (
                        <ToolTraceGroup key={entry.id} running={entry.rows.some((row) => row.data.status === 'running')}>
                            {entry.rows.map(({ id, data }) => <ToolTrace key={id} data={data} />)}
                        </ToolTraceGroup>
                    )
                    const reply = instant ? entry.message : visible.get(entry.message.id)
                    return reply && <Message key={reply.id} msg={reply} settings={settings} />
                })}
                {!hasRunningTools && (next || (pending && messages[messages.length - 1]?.role === 'user'))
                    && <ThinkingRow />}
            </div>
        </div>
    )
}

function ThinkingRow() {
    return (
        <div className="msg agent">
            <div className="thinking">
                <BrandMark size={26} orbit label="正在思考" />
            </div>
        </div>
    )
}

function EmptyState({ hasConversation, settings }: { hasConversation: boolean; settings: UiSettings }) {
    return (
        <div className="empty">
            {settings.showAvatars && <Avatar role="agent" src={settings.agentAvatar} size={40} />}
            <h2 className="empty-title">{hasConversation ? '向 Cith 说点什么' : '新建一个对话'}</h2>
        </div>
    )
}
