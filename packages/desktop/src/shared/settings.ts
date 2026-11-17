/** 桌面端设置：主进程落盘 userData/settings.json，渲染层经 IPC 读写 */
export type UiSettings = {
    fontSize: number
    lineHeight: number
    paraGap: number
    msgGap: number
    contentWidth: number
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
    backendUrl: '',
    backendToken: '',
    backendUserId: 'desktop',
}

export function mergeSettings(raw: unknown): UiSettings {
    if (typeof raw !== 'object' || raw === null) return { ...defaultSettings }
    return { ...defaultSettings, ...(raw as Partial<UiSettings>) }
}
