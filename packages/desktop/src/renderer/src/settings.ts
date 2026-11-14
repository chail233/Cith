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

const KEY = 'cith-ui-settings'

export function loadSettings(): UiSettings {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings }
    } catch {
        return { ...defaultSettings }
    }
}

export function saveSettings(s: UiSettings): void {
    localStorage.setItem(KEY, JSON.stringify(s))
}

/** 写入 CSS 变量，全界面即时生效 */
export function applySettings(s: UiSettings): void {
    const root = document.documentElement.style
    root.setProperty('--font-msg', `${s.fontSize}px`)
    root.setProperty('--leading', String(s.lineHeight))
    root.setProperty('--para-gap', `${s.paraGap}px`)
    root.setProperty('--msg-gap', `${s.msgGap}px`)
    root.setProperty('--content-width', `${s.contentWidth}px`)
}
