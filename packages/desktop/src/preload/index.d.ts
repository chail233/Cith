import type { DesktopApi } from './api'

declare global {
    interface Window {
        desktop: DesktopApi
    }
}

export {}
