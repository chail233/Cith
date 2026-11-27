import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import type { UiSettings } from '../../../shared/settings'
import type { ChatMessage, MediaSegmentData, VoiceSegmentData } from '../types'
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

export function Message({ msg, settings }: { msg: ChatMessage; settings: UiSettings }) {
    return (
        <div className={`msg ${msg.role}${settings.chatBubbles ? ' bubbled' : ''}`}>
            {settings.showAvatars && (
                <div className="msg-author">
                    <Avatar role={msg.role} src={msg.role === 'agent' ? settings.agentAvatar : settings.userAvatar} />
                </div>
            )}
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
                    if (seg.type === 'voice') return <VoiceSegment key={i} data={seg.data} />
                    return settings.showToolCalls ? <ToolTrace key={i} data={seg.data} /> : null
                })}
            </div>
        </div>
    )
}


function useMediaSource({ bytes, mime, media }: MediaSegmentData, fallbackMime: string) {
    const [blob, setBlob] = useState<{ bytes: ArrayBuffer; url: string }>()
    const contentType = mime ?? fallbackMime
    useEffect(() => {
        if (!bytes) return
        const url = URL.createObjectURL(new Blob([bytes], { type: contentType }))
        setBlob({ bytes, url })
        return () => URL.revokeObjectURL(url)
    }, [bytes, contentType])

    if (bytes) return blob?.bytes === bytes ? blob.url : undefined
    return media?.uri
}

function ImageSegment({ data }: { data: MediaSegmentData }) {
    const src = useMediaSource(data, 'image/png')
    if (!src) {
        if (data.bytes) return null
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

function AudioPlayer({ data, name }: { data: MediaSegmentData; name: string }) {
    const src = useMediaSource(data, 'audio/mpeg')
    const [failedSource, setFailedSource] = useState<string>()

    if (!src) return data.bytes ? null : <span className="msg-file-size">本地未缓存</span>
    return (
        <>
            <audio controls preload="none" src={src} aria-label={name} onError={() => setFailedSource(src)} />
            {failedSource === src && <span className="msg-file-size" role="status">无法播放音频</span>}
        </>
    )
}

function VoiceSegment({ data }: { data: VoiceSegmentData }) {
    const name = typeof data.name === 'string' && data.name.trim() ? data.name : '音频'
    return (
        <div className="msg-audio">
            <span className="msg-file-name" title={name}>{name}</span>
            <AudioPlayer data={data} name={name} />
            {typeof data.text === 'string' && data.text && <p className="msg-text">{data.text}</p>}
        </div>
    )
}

/** 文件段：原始字节可直接保存到本地；纯链接交给系统打开 */
function FileSegment({ data }: { data: MediaSegmentData }) {
    const [saved, setSaved] = useState(false)
    const name = data.name ?? '文件'

    async function save() {
        if (!data.bytes) return
        const path = await window.desktop?.saveFile?.(name, data.bytes)
        if (path) setSaved(true)
    }

    const card = (
        <div className="msg-file">
            <span className="msg-file-icon"><FileIcon size={17} /></span>
            <span className="msg-file-info">
                <span className="msg-file-name">{name}</span>
                {data.size ? <span className="msg-file-size">{fmtSize(data.size)}</span> : null}
            </span>
            {data.bytes ? (
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
    return typeof data.mime === 'string' && data.mime.startsWith('audio/')
        ? <div className="msg-audio">{card}<AudioPlayer data={data} name={name} /></div>
        : card
}
