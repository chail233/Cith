import { useEffect, useState } from 'react'
import type { UiSettings } from '../../../shared/settings.ts'
import { CloseIcon } from './icons'
import './WindowBar.css'

export function WindowBar({ closeAction }: { closeAction: UiSettings['windowCloseAction'] }) {
    const [fullScreen, setFullScreen] = useState(false)
    const api = window.desktop

    useEffect(() => {
        let receivedEvent = false
        const unsubscribe = api?.onWindowFullScreen?.((value) => {
            receivedEvent = true
            setFullScreen(value)
        })
        api?.getWindowFullScreen?.().then((value) => {
            if (!receivedEvent) setFullScreen(value)
        }).catch(() => {})
        return () => {
            receivedEvent = true
            unsubscribe?.()
        }
    }, [api])

    if (!api?.closeWindow) return null

    const fullScreenLabel = fullScreen ? '退出全屏' : '进入全屏'
    const closeLabel = closeAction === 'tray' ? '关闭窗口并隐藏到托盘' : '关闭窗口并退出应用'

    return (
        <header className="window-bar" aria-label="窗口控制">
            <button type="button" aria-label="最小化" title="最小化" onClick={api.minimizeWindow}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
                    <path d="M3.5 8.5h9" />
                </svg>
            </button>
            <button type="button" aria-label={fullScreenLabel} title={fullScreenLabel} onClick={api.toggleWindowFullScreen}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={fullScreen ? 'M2.5 6h3.5V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5' : 'M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10'} />
                </svg>
            </button>
            <button type="button" className="window-close" aria-label={closeLabel} title={closeLabel} onClick={api.closeWindow}>
                <CloseIcon />
            </button>
        </header>
    )
}
