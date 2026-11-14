/** 面板通用 UI 原子组件 */
import type { ReactNode } from "react";

/** 连接状态圆点 + 文本 */
export function StatusDot({ ok, label }: { ok: boolean; label: string }) {
    return (
        <span className={`status-dot ${ok ? "is-ok" : "is-bad"}`}>
            <span className="status-dot-light" />
            {label}
        </span>
    );
}

/** 轻量徽标 */
export function Badge({ tone = "info", children }: { tone?: "ok" | "warn" | "err" | "info" | "muted"; children: ReactNode }) {
    return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** 卡片容器 */
export function Card({ title, extra, children, className = "" }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={`card ${className}`}>
            {(title || extra) && (
                <header className="card-head">
                    <h2 className="card-title">{title}</h2>
                    {extra && <div className="card-extra">{extra}</div>}
                </header>
            )}
            {children}
        </section>
    );
}

/** 错误横幅（带重试） */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className="error-banner" role="alert">
            <span>{message}</span>
            {onRetry && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
                    重试
                </button>
            )}
        </div>
    );
}

/** 空状态占位 */
export function EmptyState({ text }: { text: string }) {
    return <div className="empty-state">{text}</div>;
}

/** 加载占位 */
export function Loading({ text = "加载中..." }: { text?: string }) {
    return <div className="empty-state is-loading">{text}</div>;
}
