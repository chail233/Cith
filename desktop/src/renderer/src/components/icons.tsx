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
