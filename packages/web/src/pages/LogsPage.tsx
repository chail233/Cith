/**
 * 事件日志页：SSE 实时事件流 + 环形缓冲补拉。
 * - 首次进入按 since=0 补拉最近 200 条（受 Bot 端 web.logBufferSize 环形缓冲容量限制）；
 * - 断线重连的补拉由 EventSource 的 Last-Event-ID 机制自动完成；
 * - log 事件渲染为日志行，未知事件名渲染为 JSON，不做硬编码假设。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, EmptyState, StatusDot } from "../components/ui";
import { useEventStream } from "../hooks/event-stream";
import { rpc } from "../api/client";
import { LOG_LEVELS, type EventFrame, type LogEventData } from "../types";

const LEVEL_TONE: Record<string, "ok" | "warn" | "err" | "muted"> = {
    INFO: "ok",
    WARN: "warn",
    ERROR: "err",
    DEBUG: "muted",
};

export default function LogsPage() {
    const { events, connected, clearEvents, ingest } = useEventStream();
    const [levels, setLevels] = useState<Set<string>>(new Set());
    const [eventName, setEventName] = useState("all");
    const [search, setSearch] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    // 首次进入补拉最近 200 条历史事件（与实时流共用去重入口，不会重复）
    useEffect(() => {
        void rpc<EventFrame[]>("get_logs", { since: 0, limit: 200 })
            .then((frames) => {
                setFetchError(null);
                ingest(Array.isArray(frames) ? frames : []);
            })
            .catch((err) => setFetchError(err instanceof Error ? err.message : String(err)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const eventNames = useMemo(() => [...new Set(events.map((e) => e.event))].sort(), [events]);

    const filtered = useMemo(() => {
        const kw = search.trim().toLowerCase();
        return events.filter((e) => {
            if (eventName !== "all" && e.event !== eventName) return false;
            if (levels.size > 0 && e.event === "log" && !levels.has(logLevel(e))) return false;
            if (kw) {
                const text = e.event === "log" ? logMsg(e) : JSON.stringify(e.data ?? "");
                if (!text.toLowerCase().includes(kw)) return false;
            }
            return true;
        });
    }, [events, eventName, levels, search]);

    // 自动滚动到底部
    useEffect(() => {
        if (autoScroll && boxRef.current) {
            boxRef.current.scrollTop = boxRef.current.scrollHeight;
        }
    }, [filtered.length, autoScroll]);

    const toggleLevel = (level: string) => {
        setLevels((prev) => {
            const next = new Set(prev);
            if (next.has(level)) next.delete(level);
            else next.add(level);
            return next;
        });
    };

    return (
        <div className="page">
            <Card
                title="事件日志"
                extra={
                    <div className="card-extra">
                        <StatusDot ok={connected} label={connected ? "实时推送中" : "重连中"} />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={clearEvents}>
                            清空显示
                        </button>
                    </div>
                }
            >
                <div className="log-toolbar">
                    <div className="level-chips">
                        {LOG_LEVELS.map((level) => (
                            <button
                                key={level}
                                type="button"
                                className={`chip chip-${level.toLowerCase()} ${levels.has(level) ? "is-active" : ""}`}
                                onClick={() => toggleLevel(level)}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                    <select className="input select" value={eventName} onChange={(e) => setEventName(e.target.value)}>
                        <option value="all">全部事件类型</option>
                        {eventNames.map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </select>
                    <input
                        className="input grow"
                        placeholder="搜索日志内容..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <label className="checkbox">
                        <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                        自动滚动
                    </label>
                </div>

                {fetchError && <div className="notice notice-err">历史补拉失败：{fetchError}</div>}

                <div className="log-box" ref={boxRef}>
                    {filtered.length === 0 ? (
                        <EmptyState text="暂无匹配的事件" />
                    ) : (
                        filtered.map((e) => <LogRow key={`${e.ts}-${e.event}-${logMsg(e).slice(0, 32)}`} frame={e} />)
                    )}
                </div>
                <div className="text-muted log-count">
                    共 {filtered.length} / {events.length} 条（本地缓冲上限 2000，Bot 端环形缓冲 1000）
                </div>
            </Card>
        </div>
    );
}

function logData(frame: EventFrame): LogEventData | null {
    if (frame.data && typeof frame.data === "object") return frame.data as LogEventData;
    return null;
}
function logMsg(frame: EventFrame): string {
    return String(logData(frame)?.msg ?? "");
}
function logLevel(frame: EventFrame): string {
    return String(logData(frame)?.level ?? "INFO");
}

function LogRow({ frame }: { frame: EventFrame }) {
    if (frame.event === "log") {
        const level = logLevel(frame);
        return (
            <div className={`log-row log-${level.toLowerCase()}`}>
                <span className="mono log-time">{new Date(frame.ts).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                <Badge tone={LEVEL_TONE[level] ?? "muted"}>{level}</Badge>
                <span className="log-msg">{logMsg(frame)}</span>
            </div>
        );
    }
    // 未知事件名：以 JSON 形式透传展示，不抛错
    return (
        <div className="log-row log-other">
            <span className="mono log-time">{new Date(frame.ts).toLocaleTimeString("zh-CN", { hour12: false })}</span>
            <Badge tone="info">{frame.event}</Badge>
            <pre className="log-msg mono">{JSON.stringify(frame.data, null, 2)}</pre>
        </div>
    );
}
