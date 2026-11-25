import { useEffect, useRef } from 'react'
import type { ChatMessage, Conversation, Segment } from '../types'
import { BrandMark } from '@cith/ui'
import { Message } from './Message'
import { Composer } from './Composer'
import './Chat.css'

type Props = {
    conversation?: Conversation
    pending: boolean
    connected: boolean
    /** 发送快捷键，来自设置页「通用」 */
    sendKey: 'enter' | 'ctrlEnter'
    onSend: (text: string, extras: Segment[]) => void
    onStop: () => void
}

export function ChatArea({ conversation, pending, connected, sendKey, onSend, onStop }: Props) {
    return (
        <main className="chat">
            <header className="chat-head">
                <div className="chat-head-drag" aria-hidden="true" />
                <div className="chat-rail">
                    {conversation && <h1 className="chat-title">{conversation.title}</h1>}
                </div>
            </header>

            {conversation?.messages.length ? (
                <MessageList messages={conversation.messages} pending={pending} />
            ) : (
                <EmptyState hasConversation={Boolean(conversation)} />
            )}

            {conversation && (
                <Composer
                    onSend={onSend}
                    onStop={onStop}
                    disabled={!connected}
                    pending={pending}
                    sendKey={sendKey}
                    hint={connected ? undefined : '未连接后端，消息无法送达 · 前往设置配置连接'}
                />
            )}
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
            <div className="msgs-col chat-rail">
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
                <BrandMark size={26} orbit />
            </div>
        </div>
    )
}

function EmptyState({ hasConversation }: { hasConversation: boolean }) {
    return (
        <div className="empty">
            <BrandMark size={40} />
            <h2 className="empty-title">{hasConversation ? '向 Cith 说点什么' : '新建一个对话'}</h2>
        </div>
    )
}
