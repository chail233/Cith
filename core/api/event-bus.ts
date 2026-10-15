import { EventEmitter } from "node:events";
import { eventLog } from "./event-log.ts";
import type { EventFrame } from "./types.ts";

/** 保留通道名：所有面板广播帧都走它，避免 server 逐个枚举事件名 */
export const FRAME_CHANNEL = "__panel_frame__";

/**
 * 单例事件总线。
 * 事件命名约定：`域.动作`，如 "log"、"message.received"、"mcp.status"。
 */
export const eventBus = new EventEmitter();

eventBus.setMaxListeners(0);

/**
 * 发布一个事件：
 * 1. 构建 EventFrame
 * 2. 写入环形缓冲 eventLog
 * 3. 派发给进程内常规监听者
 * 4. 派发到 FRAME_CHANNEL 供 API server 广播
 *
 * 监听器抛出的错误由 publish 内部 try/catch 兜底，保证事件源（Bot 主流程）安全。
 */
export function publish(event: string, data: unknown): void {
    const frame: EventFrame = { type: "event", event, ts: Date.now(), data };
    eventLog.push(frame);
    try {
        eventBus.emit(event, data);
        eventBus.emit(FRAME_CHANNEL, frame);
    } catch {
        // 监听器异常不允许反噬事件源
    }
}
