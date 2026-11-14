import { useRef, useState } from 'react'
import { SendIcon } from './icons'
import './Composer.css'

type Props = {
    onSend: (text: string) => void
    disabled: boolean
}

export function Composer({ onSend, disabled }: Props) {
    const [value, setValue] = useState('')
    const ref = useRef<HTMLTextAreaElement>(null)

    function resize() {
        const el = ref.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }

    function submit() {
        const text = value.trim()
        if (!text || disabled) return
        onSend(text)
        setValue('')
        requestAnimationFrame(() => {
            const el = ref.current
            if (el) el.style.height = 'auto'
        })
    }

    return (
        <div className="composer">
            <div className="composer-box">
                <textarea
                    ref={ref}
                    className="composer-input"
                    rows={1}
                    placeholder="给 Cith 发消息…"
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value)
                        resize()
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            submit()
                        }
                    }}
                />
                <button
                    className="composer-send"
                    onClick={submit}
                    disabled={disabled || !value.trim()}
                    aria-label="发送"
                >
                    <SendIcon />
                </button>
            </div>
            <div className="composer-hint">Enter 发送 · Shift+Enter 换行</div>
        </div>
    )
}
