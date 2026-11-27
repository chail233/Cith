import { randomUUID } from "node:crypto";
import type { Context, ToolExecutionEvent } from "../types/index.ts";
import logger from "../utils/logger.js";
import type { ToolCall } from "./types.ts";

type ToolStartEvent = Extract<ToolExecutionEvent, { type: "tool.start" }>;
type ToolEndEvent = Extract<ToolExecutionEvent, { type: "tool.end" }>;

/** 工具即将执行，返回用于配对结束事件的开始记录。 */
export function onToolStart(ctx: Context | undefined, call: ToolCall): ToolStartEvent {
    const start: ToolStartEvent = {
        type: "tool.start",
        executionId: randomUUID(),
        toolCallId: call.id,
        toolName: call.function.name,
        startedAt: Date.now(),
    };
    void sendToAdapter(ctx, { ...start });
    return start;
}

/** 执行返回或调用方结束等待时，按开始记录投递终态。 */
export function onToolEnd(ctx: Context | undefined, start: ToolStartEvent, status: ToolEndEvent["status"], output: string): void {
    void sendToAdapter(ctx, {
        ...start,
        type: "tool.end",
        status,
        output,
        durationMs: Date.now() - start.startedAt,
    });
}

/** 适配器可异步投递状态，其失败只记日志。 */
async function sendToAdapter(ctx: Context | undefined, event: ToolExecutionEvent): Promise<void> {
    try {
        await ctx?.adapter?.sendToolEvent?.(ctx.space, event);
    } catch (err) {
        logger.warn("工具执行状态投递失败:", event.type, event.toolName, err);
    }
}
