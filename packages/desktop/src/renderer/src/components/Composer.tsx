import { useRef, useState } from 'react'
import type { Segment } from '../types'
import type { PickedFile } from '../../../preload/api.ts'
import { fmtSize } from '../format'
import { CloseIcon, ImageIcon, PaperclipIcon, SendIcon, StopIcon } from './icons'
import './Composer.css'

type Props = {
    onSend: (text: string, extras: Segment[]) => void
    /** 中断后端正在跑的那一轮 */
    onStop: () => void
    /** 后端不可用等硬性禁用 */
    disabled: boolean
    /** 正在等回复：额外多一个中断键，但发音不受影响 */
    pending: boolean
    /** 发送快捷键：enter 直接发，ctrlEnter 时回车换行 */
    sendKey: 'enter' | 'ctrlEnter'
    /** 覆盖底部提示文案；缺省按状态给 */
    hint?: string
}

export function Composer({ onSend, onStop, disabled, pending, sendKey, hint }: Props) {
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
                ? { type: 'image', data: { bytes: f.bytes, mime: f.mime, name: f.name } }
                : { type: 'file', data: { bytes: f.bytes, mime: f.mime, name: f.name, size: f.size } },
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
                <div className="composer-atts chat-rail">
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
            <div className="composer-box chat-rail">
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
                        if (e.key !== 'Enter') return
                        const mod = e.ctrlKey || e.metaKey
                        // Enter 模式：回车即发；Ctrl+Enter 模式：单独回车换行
                        const send = sendKey === 'ctrlEnter' ? mod : !mod
                        if (!send || e.shiftKey) return
                        e.preventDefault()
                        submit()
                    }}
                />
                {pending && (
                    <button className="composer-stop" onClick={onStop} aria-label="中断本轮任务">
                        <StopIcon />
                    </button>
                )}
                <button
                    className="composer-send"
                    onClick={submit}
                    disabled={disabled || (value.trim() === '' && files.length === 0)}
                    aria-label="发送"
                >
                    <SendIcon />
                </button>
            </div>
            <div className="composer-hint chat-rail">
                {hint ??
                    (pending
                        ? '正在处理，可继续发送 · 方块中断'
                        : sendKey === 'ctrlEnter'
                          ? 'Ctrl+Enter 发送 · Enter 换行'
                          : 'Enter 发送 · Shift+Enter 换行')}
            </div>
        </div>
    )
}
