type IconProps = {
    size?: number
    open?: boolean
}

export function PlusIcon({ size = 15 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M8 3.2v9.6M3.2 8h9.6" />
        </svg>
    )
}

export function SendIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 12.8V3.4M4.3 7.1 8 3.4l3.7 3.7" />
        </svg>
    )
}

/** 中断：实心方块，与发送键同位置 */
export function StopIcon({ size = 13 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
        </svg>
    )
}

export function ChevronIcon({ size = 12, open = false }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 200ms var(--ease)' }}
            aria-hidden="true"
        >
            <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
    )
}

export function MoreIcon({ size = 14 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="3.2" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="12.8" cy="8" r="1.5" />
        </svg>
    )
}

export function SlidersIcon({ size = 14 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 4.5h11M2.5 11.5h11" />
            <circle cx="6" cy="4.5" r="1.8" fill="currentColor" stroke="none" />
            <circle cx="10.5" cy="11.5" r="1.8" fill="currentColor" stroke="none" />
        </svg>
    )
}

export function CloseIcon({ size = 14 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
    )
}

export function ImageIcon({ size = 15 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <circle cx="6" cy="6.2" r="1.3" />
            <path d="M13.5 10.6l-3.3-3.3-5.6 5.2" />
        </svg>
    )
}

export function PaperclipIcon({ size = 15 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.2 7.4 8.1 12.5a3.4 3.4 0 0 1-4.8-4.8l6-6a2.26 2.26 0 0 1 3.2 3.2l-5.8 5.8a1.13 1.13 0 0 1-1.6-1.6l5-5" />
        </svg>
    )
}

export function FileIcon({ size = 15 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.2 2.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.8z" />
            <path d="M9.2 2.5v3.3h3.3" />
        </svg>
    )
}
