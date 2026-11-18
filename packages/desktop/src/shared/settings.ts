/** 桌面端设置：主进程落盘 userData/settings.json，渲染层经 IPC 读写 */
export type UiSettings = {
    theme: 'dark' | 'light'
    fontSize: number
    lineHeight: number
    paraGap: number
    msgGap: number
    contentWidth: number
    sidebarWidth: number
    startAtLogin: boolean
    sendKey: 'enter' | 'ctrlEnter'
    historyLimit: number
    notifyOnReply: boolean
    backendUrl: string
    backendToken: string
    backendUserId: string
    coreMode: 'remote' | 'local'
    coreAutoStart: boolean
}

export const defaultSettings: UiSettings = {
    theme: 'dark',
    fontSize: 14,
    lineHeight: 1.75,
    paraGap: 10,
    msgGap: 24,
    contentWidth: 760,
    sidebarWidth: 262,
    startAtLogin: false,
    sendKey: 'enter',
    historyLimit: 400,
    notifyOnReply: true,
    backendUrl: '',
    backendToken: '',
    backendUserId: 'desktop',
    coreMode: 'remote',
    coreAutoStart: false,
}

export const HISTORY_LIMIT_MIN = 60
export const HISTORY_LIMIT_MAX = 600
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 420


export function mergeSettings(raw: unknown): UiSettings {
    const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const merged: Record<string, unknown> = { ...defaultSettings }
    for (const key of Object.keys(defaultSettings) as Array<keyof UiSettings>) {
        const value = source[key]
        if (typeof value === typeof defaultSettings[key]) merged[key] = value
    }
    if (merged.sendKey !== 'enter' && merged.sendKey !== 'ctrlEnter') merged.sendKey = defaultSettings.sendKey
    if (merged.coreMode !== 'remote' && merged.coreMode !== 'local') merged.coreMode = defaultSettings.coreMode
    if (merged.theme !== 'dark' && merged.theme !== 'light') merged.theme = defaultSettings.theme
    const limit = Number(merged.historyLimit)
    merged.historyLimit = Number.isFinite(limit)
        ? Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.round(limit)))
        : defaultSettings.historyLimit
    const sidebar = Number(merged.sidebarWidth)
    merged.sidebarWidth = Number.isFinite(sidebar)
        ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(sidebar)))
        : defaultSettings.sidebarWidth
    return merged as UiSettings
}