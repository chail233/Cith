import { useEffect, useRef } from 'react'
import type { ChatMessage, Conversation } from '../types'
import { BrandMark } from '@cith/ui'
import { Message } from './Message'
import { Composer } from './Composer'
import './Chat.css'

type Props = {
    conversation: Conversation
    pending: boolean
    connected: boolean
    onSend: (text: string) => void
}

export function ChatArea({ conversation, pending, connected, onSend }: Props) {
    const empty = conversation.messages.length === 0
    return (
        <main className="chat">
            <header className="chat-head">
                <h1 className="chat-title">{conversation.title}</h1>
            </header>

            {empty ? (
                <EmptyState />
            ) : (
                <MessageList messages={conversation.messages} pending={pending} />
            )}

            <Composer
                onSend={onSend}
                disabled={pending || !connected}
                hint={connected ? undefined : '未连接后端，消息无法送达 · 前往设置配置连接'}
            />
        </main>
    )
}

function MessageList({ messages, pending }: { messages: ChatMessage[]; pending: boolean }) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = ref.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages, pending])

    return (
        <div className="msgs" ref={ref}>
            <div className="msgs-col">
                {messages.map((m) => (
                    <Message key={m.id} msg={m} />
                ))}
                {pending && messages[messages.length - 1]?.role === 'user' && <TypingRow />}
            </div>
        </div>
    )
}

function TypingRow() {
    return (
        <div className="msg agent">
            <div className="typing" aria-label="正在思考">
                <BrandMark size={22} orbit />
            </div>
        </div>
    )
}

function EmptyState() {
    return (
        <div className="empty">
            <BrandMark size={44} label="Cith" />
            <h2 className="empty-title">向 Cith 说点什么</h2>
            <p className="empty-sub">在下方输入消息即可开始</p>
        </div>
    )
}
