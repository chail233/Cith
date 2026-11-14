import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Conversation, ToolTrace } from '../mock/conversations'
import { ChevronIcon } from './icons'
import { Composer } from './Composer'
import './Chat.css'

type Props = {
    conversation: Conversation
    pending: boolean
    onSend: (text: string) => void
}

export function ChatArea({ conversation, pending, onSend }: Props) {
    const empty = conversation.messages.length === 0
    return (
        <main className="chat">
            <header className="chat-head">
                <h1 className="chat-title">{conversation.title}</h1>
            </header>

            {empty ? (
                <EmptyState onPick={onSend} />
            ) : (
                <MessageList messages={conversation.messages} pending={pending} />
            )}

            <Composer onSend={onSend} disabled={pending} />
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
                {pending && messages[messages.length - 1]?.role === "user" && <TypingRow />}
            </div>
        </div>
    )
}

function Message({ msg }: { msg: ChatMessage }) {
    return (
        <div className={`msg ${msg.role}`}>
            <div className="msg-segs">
                {msg.segments.map((seg, i) =>
                    seg.kind === 'text' ? (
                        <div key={i} className="msg-text">
                            {seg.text
                                .split(/\n{2,}/)
                                .map((para, j) => (
                                    <p key={j} className="msg-para">{renderText(para)}</p>
                                ))}
                        </div>
                    ) : (
                        <ToolTrace key={i} trace={seg} />
                    ),
                )}
            </div>
            <span className="msg-time">{msg.time}</span>
        </div>
    )
}

/** 只处理 `行内代码` 一种标记，够聊天场景用 */
function renderText(text: string) {
    return text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith('`') && part.endsWith('`')
            ? <code key={i}>{part.slice(1, -1)}</code>
            : part,
    )
}

function ToolTrace({ trace }: { trace: ToolTrace }) {
    const [open, setOpen] = useState(false)
    const statusText = trace.status === 'ok' ? '完成' : trace.status === 'error' ? '出错' : '运行中'
    const duration = trace.durationMs != null ? ` · ${(trace.durationMs / 1000).toFixed(1)}s` : ''

    return (
        <div className={`trace ${trace.status}${open ? ' open' : ''}`}>
            <button className="trace-bar" onClick={() => setOpen(!open)}>
                <ChevronIcon open={open} />
                <span className="trace-name">{trace.name}</span>
                <span className="trace-summary">{trace.summary}</span>
                <span className="trace-status">
                    <i className={`trace-dot ${trace.status}`} />
                    {statusText}{duration}
                </span>
            </button>
            <div className="trace-body">
                <div className="trace-pad">
                    {trace.command && (
                        <div className="trace-cmd">
                            <span className="trace-prompt">$</span>
                            {trace.command}
                        </div>
                    )}
                    {trace.output && <pre className="trace-out">{trace.output}</pre>}
                </div>
            </div>
        </div>
    )
}

function TypingRow() {
    return (
        <div className="msg agent">
            <div className="typing" aria-label="正在思考">
                <i /><i /><i />
            </div>
        </div>
    )
}

const SUGGESTIONS = ['看看今天的构建状态', '总结一下最近的记忆', '随便聊点什么']

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
    return (
        <div className="empty">
            <span className="empty-mark" />
            <h2 className="empty-title">向 Cith 说点什么</h2>
            <p className="empty-sub">演示数据 · 后端协议接通后这里是真实会话</p>
            <div className="sugs">
                {SUGGESTIONS.map((s) => (
                    <button key={s} className="sug" onClick={() => onPick(s)}>
                        {s}
                    </button>
                ))}
            </div>
        </div>
    )
}
