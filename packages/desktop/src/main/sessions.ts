import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { MAX_SNAPSHOT_BYTES, SESSIONS_VERSION, type PersistedSessions } from '../shared/session.ts'


function file(): string {
    return join(app.getPath('userData'), 'sessions.json')
}

/** 读取快照；文件缺失、损坏或版本不认识时返回 null（渲染层按空会话起步） */
export function loadSessions(): PersistedSessions | null {
    try {
        const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<PersistedSessions>
        if (!Array.isArray(raw.conversations) || !Array.isArray(raw.archived)) return null
        return {
            version: SESSIONS_VERSION,
            conversations: raw.conversations,
            archived: raw.archived,
            activeId: typeof raw.activeId === 'string' ? raw.activeId : '',
        }
    }
    catch {
        return null
    }
}

/** 写入快照：先写临时文件再改名，避免写到一半退出留下半截 JSON */
export function saveSessions(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return
    let text: string
    try {
        text = JSON.stringify(raw)
    }
    catch (err) {
        console.warn('会话快照序列化失败，已跳过落盘:', err)
        return
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_SNAPSHOT_BYTES) {
        console.warn(`会话快照超过体积上限（${MAX_SNAPSHOT_BYTES} 字节），已跳过落盘`)
        return
    }
    const target = file()
    const temp = `${target}.tmp`
    try {
        writeFileSync(temp, text)
        renameSync(temp, target)
    }
    catch (err) {
        console.warn('会话快照落盘失败:', err)
    }
}
