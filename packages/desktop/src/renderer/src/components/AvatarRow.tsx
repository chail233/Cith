import { useRef, useState } from 'react'
import { Avatar } from './Avatar'
import type { ChatMessage } from '../types'

/** 只把居中裁切过的缩略图存入设置，原文件留在本机。 */
async function thumbnail(file: File): Promise<string> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片。')
    if (file.size > 10 * 1024 * 1024) throw new Error('请选择小于 10 MB 的图片。')
    const bitmap = await createImageBitmap(file)
    try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 160
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error()
        const edge = Math.min(bitmap.width, bitmap.height)
        ctx.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 160, 160)
        return canvas.toDataURL('image/webp', 0.85)
    }
    finally {
        bitmap.close()
    }
}

export function AvatarRow({ role, value, onChange }: { role: ChatMessage['role']; value: string; onChange: (src: string) => void }) {
    const input = useRef<HTMLInputElement>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const label = role === 'agent' ? 'AI 头像' : '我的头像'

    async function select(file?: File) {
        if (!file) return
        setError('')
        setBusy(true)
        try { onChange(await thumbnail(file)) }
        catch (e) { setError(e instanceof Error && e.name === 'Error' && e.message ? e.message : '无法读取图片，请重新选择。') }
        finally { setBusy(false) }
    }

    return (
        <div className="action-row avatar-row">
            <Avatar role={role} src={value} size={36} />
            <div className="switch-text">
                <span className="field-label">{label}</span>
                {error && <span className="field-hint failure" role="alert">{error}</span>}
            </div>
            <input hidden type="file" ref={input} accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                void select(event.target.files?.[0])
                event.target.value = ''
            }} />
            {value && <button className="reset-btn" disabled={busy} aria-label={`恢复默认${label}`} onClick={() => { setError(''); onChange('') }}>恢复默认</button>}
            <button className="action-btn" disabled={busy} aria-label={`更换${label}`} onClick={() => input.current?.click()}>
                {busy ? '读取中…' : '选择图片'}
            </button>
        </div>
    )
}
