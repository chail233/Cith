/** 桌面端设置：主进程落盘 userData/settings.json，渲染层经 IPC 读写 */
export type UiSettings = {
    fontSize: number
    lineHeight: number
    paraGap: number
    msgGap: number
    contentWidth: number
    /** 消息通道地址（DesktopServer），空 = 未配置 */
    backendUrl: string
    /** 通道 token；协议握手定下后随连接下发，当前仅存储 */
    backendToken: string
    /** 桌面频道身份（随消息帧携带），决定后端会话归属 */
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

/** 任意输入并入默认值：文件残缺或字段缺失都能回落成完整设置 */
export function mergeSettings(raw: unknown): UiSettings {
    if (typeof raw !== 'object' || raw === null) return { ...defaultSettings }
    return { ...defaultSettings, ...(raw as Partial<UiSettings>) }
}
