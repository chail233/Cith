import { useEffect, useState } from 'react'
import type { ChatMessage, MediaSegmentData } from '../types'
import { fmtSize } from '../format'
import { FileIcon } from './icons'
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
                {msg.segments.map((seg, i) => {
                    if (seg.type === 'text') {
                        return (
                            <div key={i} className="msg-text">
                                {seg.data.text
                                    .split(/\n{2,}/)
                                    .map((para, j) => (
                                        <p key={j} className="msg-para">{renderText(para)}</p>
                                    ))}
                            </div>
                        )
                    }
                    if (seg.type === 'image') return <ImageSegment key={i} data={seg.data} />
                    if (seg.type === 'file') return <FileSegment key={i} data={seg.data} />
                    return <ToolTrace key={i} data={seg.data} />
                })}
            </div>
            <span className="msg-time">{msg.time}</span>
        </div>
    )
}


function ImageSegment({ data }: { data: MediaSegmentData }) {
    const [blobUrl, setBlobUrl] = useState<string>()
    const { bytes, mime } = data
    useEffect(() => {
        if (!bytes) return
        const url = URL.createObjectURL(new Blob([bytes], { type: mime ?? 'image/png' }))
        setBlobUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [bytes, mime])

    let src = data.media?.uri
    if (bytes) src = blobUrl
    else if (data.base64) src = `data:${mime ?? 'image/png'};base64,${data.base64}`
    if (!src) {
        if (bytes) return null
        // 从快照恢复的超限图片只有元信息，显示文件卡占位
        return (
            <div className="msg-file">
                <span className="msg-file-icon"><FileIcon size={17} /></span>
                <span className="msg-file-info">
                    <span className="msg-file-name">{data.name ?? '图片'}</span>
                    <span className="msg-file-size">本地未缓存</span>
                </span>
            </div>
        )
    }
    return <img className="msg-img" src={src} alt={data.name ?? '图片'} />
}

/** 文件段：base64 可直接保存到本地；纯链接交给系统打开 */
function FileSegment({ data }: { data: MediaSegmentData }) {
    const [saved, setSaved] = useState(false)
    const name = data.name ?? '文件'

    async function save() {
        if (!data.base64) return
        const path = await window.desktop?.saveFile?.(name, data.base64)
        if (path) setSaved(true)
    }

    return (
        <div className="msg-file">
            <span className="msg-file-icon"><FileIcon size={17} /></span>
            <span className="msg-file-info">
                <span className="msg-file-name">{name}</span>
                {data.size ? <span className="msg-file-size">{fmtSize(data.size)}</span> : null}
            </span>
            {data.base64 ? (
                <button className="msg-file-act" onClick={save} disabled={saved}>
                    {saved ? '已保存' : '保存'}
                </button>
            ) : data.media?.uri ? (
                <button className="msg-file-act" onClick={() => void window.desktop?.openExternal?.(data.media!.uri!)}>
                    打开链接
                </button>
            ) : null}
        </div>
    )
}
