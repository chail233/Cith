/** 桌面端设置：主进程落盘 userData/settings.json，渲染层经 IPC 读写 */
export type UiSettings = {
    fontSize: number
    lineHeight: number
    paraGap: number
    msgGap: number
    contentWidth: number
    startAtLogin: boolean
    sendKey: 'enter' | 'ctrlEnter'
    historyLimit: number
    notifyOnReply: boolean
    backendUrl: string
    backendToken: string
    backendUserId: string
}

export const defaultSettings: UiSettings = {
    fontSize: 14,
    lineHeight: 1.75,
    paraGap: 10,
    msgGap: 24,
    contentWidth: 760,
    startAtLogin: false,
    sendKey: 'enter',
    historyLimit: 400,
    notifyOnReply: true,
    backendUrl: '',
    backendToken: '',
    backendUserId: 'desktop',
}

export const HISTORY_LIMIT_MIN = 60
export const HISTORY_LIMIT_MAX = 600


export function mergeSettings(raw: unknown): UiSettings {
    const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const merged: Record<string, unknown> = { ...defaultSettings }
    for (const key of Object.keys(defaultSettings) as Array<keyof UiSettings>) {
        const value = source[key]
        if (typeof value === typeof defaultSettings[key]) merged[key] = value
    }
    if (merged.sendKey !== 'enter' && merged.sendKey !== 'ctrlEnter') merged.sendKey = defaultSettings.sendKey
    const limit = Number(merged.historyLimit)
    merged.historyLimit = Number.isFinite(limit)
        ? Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.round(limit)))
        : defaultSettings.historyLimit
    return merged as UiSettings
}