/** 运行状态页：get_status 快照（5s 轮询）+ 最近事件速览 */
import { Badge, Card, EmptyState, ErrorBanner, Loading } from "../components/ui";
import { useEventStream } from "../hooks/event-stream";
import { usePolling } from "../hooks/usePolling";
import { rpc } from "../api/client";
import type { BotStatus, ConfigWarning, TokenUsageBucket, TokenUsageSummary } from "../types";
import { formatCacheRate, formatTime, formatTokens, formatUptime } from "../utils/format";

export default function Dashboard() {
    const { data: status, error, loading, refresh } = usePolling(() => rpc<BotStatus>("get_status"), 5000);
    const { data: usage } = usePolling(() => rpc<TokenUsageSummary>("get_token_usage", { days: 7 }), 60_000);
    const { events } = useEventStream();
    const recent = events.slice(-8).reverse();
    const warnings = status?.configWarnings ?? [];

    return (
        <div className="page">
            {error && <ErrorBanner message={`获取运行状态失败：${error}`} onRetry={refresh} />}
            {warnings.length > 0 && <PreflightWarnings warnings={warnings} />}
            {loading && !status ? (
                <Loading text="正在获取运行状态..." />
            ) : status ? (
                <>
                    <div className="stat-grid">
                        <div className="stat-card">
                            <div className="stat-label">运行时长</div>
                            <div className="stat-value">{formatUptime(status.uptimeMs)}</div>
                            <div className="stat-sub">每 5 秒自动刷新</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">OneBot（NapCat）</div>
                            <div className="stat-value">
                                <Badge tone={status.onebotConnected ? "ok" : "err"}>
                                    {status.onebotConnected ? "在线" : "离线"}
                                </Badge>
                            </div>
                            <div className="stat-sub">消息适配器连接状态</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">MCP 连接数</div>
                            <div className="stat-value">{status.mcpConnections}</div>
                            <div className="stat-sub">已连接的 MCP Server</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">堆内存占用</div>
                            <div className="stat-value">
                                {status.memoryMb} <span className="stat-unit">MB</span>
                            </div>
                            <div className="stat-sub">Node.js heapUsed</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Node 版本</div>
                            <div className="stat-value stat-value-sm">{status.nodeVersion}</div>
                            <div className="stat-sub">Bot 进程运行时</div>
                        </div>
                    </div>

                    {usage && <TokenUsageCard usage={usage} />}

                    <Card title="最近事件" extra={<span className="text-muted">实时推送，完整列表见「事件日志」</span>}>
                        {recent.length === 0 ? (
                            <EmptyState text="暂无事件，等待 Bot 推送..." />
                        ) : (
                            <ul className="mini-feed">
                                {recent.map((e) => (
                                    <li key={`${e.ts}-${e.event}`} className="mini-feed-item">
                                        <span className="mono text-muted">{formatTime(e.ts)}</span>
                                        <Badge tone={e.event === "log" ? "muted" : "info"}>{e.event}</Badge>
                                        <span className="mini-feed-text">{eventPreview(e)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                </>
            ) : (
                <EmptyState text="暂无数据" />
            )}
        </div>
    );
}

/** Token 用量卡片：今日概览 + 近 7 天分天明细 + 累计（60s 轮询） */
function TokenUsageCard({ usage }: { usage: TokenUsageSummary }) {
    const today = usage.today;
    return (
        <Card title="Token 用量" extra={<span className="text-muted">来自模型服务商 usage 统计，每 60 秒刷新</span>}>
            <div className="stat-grid">
                <div className="stat-card">
                    <div className="stat-label">今日总消耗</div>
                    <div className="stat-value">
                        {formatTokens(today.totalTokens)} <span className="stat-unit">tokens</span>
                    </div>
                    <div className="stat-sub">{today.requests} 次调用 · 缓存命中 {hitRate(today)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">今日输入 / 输出</div>
                    <div className="stat-value stat-value-sm">
                        {formatTokens(today.inputTokens)} / {formatTokens(today.outputTokens)}
                    </div>
                    <div className="stat-sub">缓存命中 {formatTokens(today.cachedTokens)}（{hitRate(today)}）</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">累计总消耗</div>
                    <div className="stat-value">
                        {formatTokens(usage.total.totalTokens)} <span className="stat-unit">tokens</span>
                    </div>
                    <div className="stat-sub">{usage.total.requests} 次调用 · 缓存命中 {hitRate(usage.total)}</div>
                </div>
            </div>
            {usage.recent.length > 0 && (
                <div className="table-wrap">
                    <table className="config-table">
                        <thead>
                        <tr>
                            <th>日期</th>
                            <th>输入</th>
                            <th>缓存命中</th>
                            <th>命中率</th>
                            <th>输出</th>
                            <th>合计</th>
                            <th>调用次数</th>
                        </tr>
                    </thead>
                    <tbody>
                        {usage.recent.slice().reverse().map((d) => (
                            <tr key={d.date}>
                                <td className="mono">{d.date?.slice(5)}</td>
                                <td className="mono">{formatTokens(d.inputTokens)}</td>
                                <td className="mono">{formatTokens(d.cachedTokens)}</td>
                                <td className="mono">{hitRate(d)}</td>
                                <td className="mono">{formatTokens(d.outputTokens)}</td>
                                <td className="mono">{formatTokens(d.totalTokens)}</td>
                                <td className="mono">{d.requests}</td>
                            </tr>
                        ))}
                    </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
}

/**
 * 缓存命中率文本：优先用后端算好的值；
 * 面板可能连的是旧版 Bot（无 cacheHitRate 字段），此时按 cached / input 兜底
 */
function hitRate(b: TokenUsageBucket): string {
    const rate = typeof b.cacheHitRate === "number"
        ? b.cacheHitRate
        : b.inputTokens > 0 ? Math.round((b.cachedTokens / b.inputTokens) * 1000) / 10 : null;
    return formatCacheRate(rate);
}

/** 启动配置自检告警：常驻页面顶部，error 级红色、warn 级橙色 */
function PreflightWarnings({ warnings }: { warnings: ConfigWarning[] }) {
    const hasFatal = warnings.some((w) => w.level === "error");
    return (
        <div className={`config-warning-banner ${hasFatal ? "is-fatal" : ""}`} role="alert">
            <div className="config-warning-head">
                <strong>配置自检：{warnings.length} 项待处理</strong>
                <span className="config-warning-hint">修改后重启 Bot 生效</span>
            </div>
            <ul className="config-warning-list">
                {warnings.map((w) => (
                    <li key={w.key}>
                        <Badge tone={w.level === "error" ? "err" : "warn"}>
                            {w.level === "error" ? "致命" : "提示"}
                        </Badge>
                        <span>{w.message}</span>
                        <span className="config-warning-fix">修复：{w.fix}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** 事件预览文本：log 取 msg，其它取 data 摘要 */
function eventPreview(e: { event: string; data: unknown }): string {
    if (e.event === "log" && e.data && typeof e.data === "object") {
        return String((e.data as { msg?: unknown }).msg ?? "");
    }
    try {
        return JSON.stringify(e.data)?.slice(0, 80) ?? "";
    } catch {
        return "";
    }
}
