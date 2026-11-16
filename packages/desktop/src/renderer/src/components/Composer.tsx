import { useRef, useState } from 'react'
import type { Segment } from '../types'
import type { PickedFile } from '../../../preload/api.ts'
import { fmtSize } from '../format'
import { CloseIcon, ImageIcon, PaperclipIcon, SendIcon } from './icons'
import './Composer.css'

type Props = {
    onSend: (text: string, extras: Segment[]) => void
    disabled: boolean
    /** 覆盖底部提示文案；缺省为快捷键说明 */
    hint?: string
}

export function Composer({ onSend, disabled, hint }: Props) {
    const [value, setValue] = useState('')
    const [files, setFiles] = useState<PickedFile[]>([])
    const ref = useRef<HTMLTextAreaElement>(null)

    function resize() {
        const el = ref.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }

    async function pick(kind: 'image' | 'file') {
        if (disabled) return
        const picked = await window.desktop?.pickFiles?.(kind)
        if (picked?.length) setFiles((cur) => [...cur, ...picked])
    }

    function submit() {
        const text = value.trim()
        if (disabled || (text === '' && files.length === 0)) return
        const extras: Segment[] = files.map((f) =>
            f.kind === 'image'
                ? { type: 'image', data: { base64: f.base64, mime: f.mime, name: f.name } }
                : { type: 'file', data: { base64: f.base64, mime: f.mime, name: f.name, size: f.size } },
        )
        onSend(text, extras)
        setValue('')
        setFiles([])
        requestAnimationFrame(() => {
            const el = ref.current
            if (el) el.style.height = 'auto'
        })
    }

    return (
        <div className="composer">
            {files.length > 0 && (
                <div className="composer-atts">
                    {files.map((f, i) => (
                        <span key={`${f.path}-${i}`} className="att-chip">
                            <span className="att-name">{f.name}</span>
                            <span className="att-size">{fmtSize(f.size)}</span>
                            <button
                                className="att-remove"
                                aria-label="移除附件"
                                onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                            >
                                <CloseIcon size={11} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className="composer-box">
                <div className="composer-tools">
                    <button className="composer-tool" onClick={() => void pick('image')} disabled={disabled} aria-label="发送图片">
                        <ImageIcon />
                    </button>
                    <button className="composer-tool" onClick={() => void pick('file')} disabled={disabled} aria-label="发送文件">
                        <PaperclipIcon />
                    </button>
                </div>
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
                    disabled={disabled || (value.trim() === '' && files.length === 0)}
                    aria-label="发送"
                >
                    <SendIcon />
                </button>
            </div>
            <div className="composer-hint">{hint ?? 'Enter 发送 · Shift+Enter 换行'}</div>
        </div>
    )
}
