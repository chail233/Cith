export type DesktopUpdateStatus =
    | { phase: 'idle' | 'checking' | 'current' }
    | { phase: 'available' | 'downloaded'; version: string; error?: string }
    | { phase: 'downloading'; version: string; percent?: number }
    | { phase: 'installing'; version: string }
    | { phase: 'error'; error: string }

export type DesktopUpdateState = {
    mode: 'installer' | 'portable' | 'unsupported'
    status: DesktopUpdateStatus
}
