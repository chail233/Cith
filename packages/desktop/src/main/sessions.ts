import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { deserialize, serialize } from 'node:v8'
import { MAX_SNAPSHOT_BYTES, SESSIONS_VERSION, type PersistedSessions } from '../shared/session.ts'

function toSessions(raw: unknown): PersistedSessions | null {
    const snapshot = raw as Partial<PersistedSessions> | null
    if (!Array.isArray(snapshot?.conversations) || !Array.isArray(snapshot.archived)) return null
    return {
        version: SESSIONS_VERSION,
        conversations: snapshot.conversations,
        archived: snapshot.archived,
        activeId: typeof snapshot.activeId === 'string' ? snapshot.activeId : '',
    }
}

/** 读取当前版本的二进制快照。 */
export function loadSessions(directory: string): PersistedSessions | null {
    try {
        const raw = deserialize(readFileSync(join(directory, 'sessions.bin')))
        return raw?.version === SESSIONS_VERSION ? toSessions(raw) : null
    }
    catch {
        return null
    }
}

/** 原子替换二进制快照。 */
export function saveSessions(directory: string, raw: unknown): void {
    const snapshot = toSessions(raw)
    if (!snapshot) return
    let bytes: Buffer
    try {
        bytes = serialize(snapshot)
    }
    catch (err) {
        process.emitWarning(`会话快照序列化失败，已跳过落盘: ${String(err)}`)
        return
    }
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
        process.emitWarning(`会话快照超过体积上限（${MAX_SNAPSHOT_BYTES} 字节），已跳过落盘`)
        return
    }
    const target = join(directory, 'sessions.bin')
    const temp = `${target}.tmp`
    try {
        writeFileSync(temp, bytes)
        renameSync(temp, target)
    }
    catch (err) {
        process.emitWarning(`会话快照落盘失败: ${String(err)}`)
    }
}

export function clearSessions(directory: string): void {
    for (const name of ['sessions.bin', 'sessions.bin.tmp']) {
        removeSnapshot(join(directory, name))
    }
}

function removeSnapshot(path: string): void {
    try {
        unlinkSync(path)
    }
    catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') process.emitWarning(`会话快照删除失败: ${String(err)}`)
    }
}
