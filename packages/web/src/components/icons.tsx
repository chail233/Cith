/** 面板手写 SVG 图标：1.75 描边 + currentColor，与桌面端 icons.tsx 同一画法 */
import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

/** 运行状态：脉搏线 */
export function IconPulse() {
    return (
        <Svg>
            <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
        </Svg>
    );
}

/** 模型价格：叠起的硬币 */
export function IconCoins() {
    return (
        <Svg>
            <ellipse cx="12" cy="6.5" rx="7" ry="3" />
            <path d="M5 6.5v5.5c0 1.66 3.13 3 7 3s7-1.34 7-3V6.5" />
            <path d="M5 12v5.5c0 1.66 3.13 3 7 3s7-1.34 7-3V12" />
        </Svg>
    );
}

/** 系统提示词：笔 */
export function IconQuill() {
    return (
        <Svg>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </Svg>
    );
}

/** 配置管理：三路滑杆 */
export function IconTune() {
    return (
        <Svg>
            <path d="M4 7h8" />
            <circle cx="15" cy="7" r="2.3" />
            <path d="M17.3 7H20" />
            <path d="M20 12h-8" />
            <circle cx="9" cy="12" r="2.3" />
            <path d="M6.7 12H4" />
            <path d="M4 17h8" />
            <circle cx="15" cy="17" r="2.3" />
            <path d="M17.3 17H20" />
        </Svg>
    );
}

/** 事件日志：行列表 */
export function IconList() {
    return (
        <Svg>
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h10" />
        </Svg>
    );
}

/** 能力清单：闪电 */
export function IconZap() {
    return (
        <Svg>
            <path d="M13 2 4.5 13.5H11L9.5 22 18.5 10.5H12L13 2z" />
        </Svg>
    );
}
