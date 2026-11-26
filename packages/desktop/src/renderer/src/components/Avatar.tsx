import { BrandMark } from '@cith/ui'
import type { ChatMessage } from '../types'

export function Avatar({ role, src, size = 26 }: { role: ChatMessage['role']; src: string; size?: number }) {
    if (!src && role === 'agent') return <BrandMark size={size} />
    const style = { width: size, height: size }
    return src
        ? <img className="chat-avatar" style={style} src={src} alt="" />
        : <span className="chat-avatar" style={style} aria-hidden="true">
            <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="10" cy="6.5" r="3" />
                <path d="M3.5 17a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
            </svg>
        </span>
}
