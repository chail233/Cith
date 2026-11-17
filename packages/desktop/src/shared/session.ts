export type PersistedSessions = {
    version: number
    conversations: unknown[]
    archived: unknown[]
    activeId: string
}

export const SESSIONS_VERSION = 1

/** 快照文件体积上限（base64 媒体是大头），超出拒绝写入 */
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
