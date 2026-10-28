/**
 * 全局事件流（SSE）：App 级 Provider，状态页/日志页共享同一份实时事件缓冲。
 *
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { EventFrame } from "../types";
import { eventStreamUrl } from "../api/client";

const MAX_EVENTS = 2000;

interface EventStreamValue {
    /** 按到达顺序保存的事件（ts 升序） */
    events: EventFrame[];
    /** SSE 是否已连接（重连中为 false） */
    connected: boolean;
    /** 清空本地缓冲（不影响 Bot 端环形缓冲） */
    clearEvents: () => void;
    /** 手动灌入一批事件（初始补拉 get_logs 用），自动去重并按 ts 排序 */
    ingest: (frames: EventFrame[]) => void;
}

const EventStreamContext = createContext<EventStreamValue>({
    events: [],
    connected: false,
    clearEvents: () => {},
    ingest: () => {},
});

export function EventStreamProvider({ children }: { children: ReactNode }) {
    const [events, setEvents] = useState<EventFrame[]>([]);
    const [connected, setConnected] = useState(false);
    const seenKeysRef = useRef(new Set<string>());

    const clearEvents = () => {
        seenKeysRef.current.clear();
        setEvents([]);
    };

    /** 去重 + 追加 + 按 ts 排序 + 容量裁剪；实时帧与补拉帧共用同一条入口 */
    const ingest = (frames: EventFrame[]) => {
        const fresh: EventFrame[] = [];
        for (const frame of frames) {
            if (frame?.type !== "event" || typeof frame.ts !== "number" || typeof frame.event !== "string") {
                continue; // 未知结构事件帧做兼容处理：忽略
            }
            const key = `${frame.ts}|${frame.event}|${JSON.stringify(frame.data)}`;
            if (seenKeysRef.current.has(key)) continue; // 补拉与实时推送重叠时去重
            seenKeysRef.current.add(key);
            fresh.push(frame);
        }
        if (fresh.length === 0) return;
        if (seenKeysRef.current.size > MAX_EVENTS * 2) {
            seenKeysRef.current = new Set([...seenKeysRef.current].slice(-MAX_EVENTS));
        }
        setEvents((prev) => {
            const next = [...prev, ...fresh].sort((a, b) => a.ts - b.ts);
            return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
    };

    useEffect(() => {
        const es = new EventSource(eventStreamUrl());

        const handleMessage = (e: MessageEvent<string>) => {
            setConnected(true);
            let frame: EventFrame;
            try {
                frame = JSON.parse(e.data) as EventFrame;
            } catch {
                return; // 非法帧丢弃（对应协议里 id 为空串的兜底 error 帧，正常不会出现在事件流）
            }
            ingest([frame]);
        };

        es.onmessage = handleMessage;
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false); // EventSource 会自动重连，无需手动处理

        return () => es.close();
    }, []);

    return (
        <EventStreamContext.Provider value={{ events, connected, clearEvents, ingest }}>
            {children}
        </EventStreamContext.Provider>
    );
}

export function useEventStream(): EventStreamValue {
    return useContext(EventStreamContext);
}
