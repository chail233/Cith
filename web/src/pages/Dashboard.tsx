/** 运行状态页：get_status 快照（5s 轮询）+ 最近事件速览 */
import { Badge, Card, EmptyState, ErrorBanner, Loading } from "../components/ui";
import { useEventStream } from "../hooks/event-stream";
import { usePolling } from "../hooks/usePolling";
import { rpc } from "../api/client";
import type { BotStatus } from "../types";
import { formatTime, formatUptime } from "../utils/format";

export default function Dashboard() {
    const { data: status, error, loading, refresh } = usePolling(() => rpc<BotStatus>("get_status"), 5000);
    const { events } = useEventStream();
    const recent = events.slice(-8).reverse();

    return (
        <div className="page">
            {error && <ErrorBanner message={`获取运行状态失败：${error}`} onRetry={refresh} />}
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
