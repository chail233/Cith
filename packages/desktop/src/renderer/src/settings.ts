import type { UiSettings } from '../../shared/settings.ts'

/** 写入 CSS 变量，全界面生效 */
export function applySettings(s: UiSettings): void {
    const root = document.documentElement.style
    root.setProperty('--font-msg', `${s.fontSize}px`)
    root.setProperty('--leading', String(s.lineHeight))
    root.setProperty('--para-gap', `${s.paraGap}px`)
    root.setProperty('--msg-gap', `${s.msgGap}px`)
    root.setProperty('--content-width', `${s.contentWidth}px`)
}
