import './BrandMark.css'

type Props = {
    /** 渲染尺寸（正方形边长，px） */
    size?: number
    /** 加载态：C 沿 ith 缓慢公转（ith 不动） */
    orbit?: boolean
    /** 无障碍名称；传入时按图片语义暴露，未传时视为装饰 */
    label?: string
}

/**
 * 品牌标：C 罩（琥珀）罩住 ith 焰心（暖白）。
 * C 是罩、ith 是被罩住的灯——「壁炉的一盏灯」的字标化；
 * orbit 变体即加载指示：C 沿 ith 公转，不需要另造动画。
 */
export function BrandMark({ size = 24, orbit = false, label }: Props) {
    return (
        <svg
            className={`brandmark${orbit ? ' orbit' : ''}`}
            width={size}
            height={size}
            viewBox="0 0 32 32"
            role={label ? 'img' : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            <path
                className="brandmark-arc"
                d="M16.9 5.5 A10.5 10.5 0 1 0 26.1 13.3"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="3.2"
                strokeLinecap="round"
            />
            <text className="brandmark-ith" x="16" y="19.6" textAnchor="middle" fontSize="11" letterSpacing="-0.3">
                ith
            </text>
        </svg>
    )
}
