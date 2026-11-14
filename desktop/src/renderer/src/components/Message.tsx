import type { ChatMessage } from '../types'
import { ToolTrace } from './ToolTrace'
import './Message.css'

/** 只处理 `行内代码` 一种标记，够聊天场景用 */
function renderText(text: string) {
    return text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith('`') && part.endsWith('`')
            ? <code key={i}>{part.slice(1, -1)}</code>
            : part,
    )
}

export function Message({ msg }: { msg: ChatMessage }) {
    return (
        <div className={`msg ${msg.role}`}>
            <div className="msg-segs">
                {msg.segments.map((seg, i) =>
                    seg.type === 'text' ? (
                        <div key={i} className="msg-text">
                            {seg.data.text
                                .split(/\n{2,}/)
                                .map((para, j) => (
                                    <p key={j} className="msg-para">{renderText(para)}</p>
                                ))}
                        </div>
                    ) : (
                        <ToolTrace key={i} data={seg.data} />
                    ),
                )}
            </div>
            <span className="msg-time">{msg.time}</span>
        </div>
    )
}
