import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Conversation, Segment } from '../types'
import type { UiSettings } from '../../../shared/settings'
import { Avatar } from './Avatar'
import { BrandMark } from '@cith/ui'
import { Message } from './Message'
import { Composer } from './Composer'
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
    return (
        <main className="chat">
            <header className="chat-head">
                <div className="chat-head-drag" aria-hidden="true" />
                <div className="chat-rail">
                    {conversation && <h1 className="chat-title">{conversation.title}</h1>}
                </div>
            </header>

            {conversation?.messages.length ? (
                <MessageList messages={conversation.messages} pending={pending} settings={settings} />
            ) : (
                <EmptyState avatar={settings.agentAvatar} hasConversation={Boolean(conversation)} />
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

function MessageList({ messages, pending, settings }: { messages: ChatMessage[]; pending: boolean; settings: UiSettings }) {
    const ref = useRef<HTMLDivElement>(null)

    // 刚进入会话时历史全部可见。游标只控制本次查看期间新增回复的展示。
    const [cursor, setCursor] = useState({ message: messages.length, segment: 0 })
    const instant = !settings.pacedReplies || messages[messages.length - 1]?.role === 'user'
    const shown = instant ? messages.length : cursor.message
    const next = messages[shown]
    const segment = next?.segments[cursor.segment]
    const visible = messages.slice(0, shown)
    if (next && cursor.segment > 0) {
        visible.push({ ...next, segments: next.segments.slice(0, cursor.segment) })
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

    useEffect(() => {
        const el = ref.current
        if (el) el.scrollTop = el.scrollHeight
    }, [shown, cursor.segment, pending, next])

    return (
        <div className="msgs" ref={ref}>
            <div className="msgs-col chat-rail">
                {visible.map((m) => (
                    <Message key={m.id} msg={m} settings={settings} />
                ))}
                {(next || (pending && messages[messages.length - 1]?.role === 'user')) && <TypingRow avatar={settings.agentAvatar} />}
            </div>
        </div>
    )
}

function TypingRow({ avatar }: { avatar: string }) {
    return (
        <div className="msg agent">
            <div className="typing" aria-label="正在思考">
                {avatar ? <><Avatar role="agent" src={avatar} /><span>正在输入…</span></> : <BrandMark size={26} orbit />}
            </div>
        </div>
    )
}

function EmptyState({ hasConversation, avatar }: { hasConversation: boolean; avatar: string }) {
    return (
        <div className="empty">
            <Avatar role="agent" src={avatar} size={40} />
            <h2 className="empty-title">{hasConversation ? '向 Cith 说点什么' : '新建一个对话'}</h2>
        </div>
    )
}
