import crypto from "node:crypto";
import logger from "../utils/logger.js";
import type { ToolCall } from "./types.ts";
import type { Space } from "../types/index.ts";


export interface PendingToolCall {
    toolCall: ToolCall;
    toolName: string;
    requestedBy: string;
    requestedByName: string;
    space: Space | null;
    createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 分钟
const MAX_PENDING = 20;

const pending = new Map<string, PendingToolCall>();

function sweepExpired() {
    const now = Date.now();
    for (const [id, entry] of pending) {
        if (now - entry.createdAt > TTL_MS) {
            pending.delete(id);
            logger.info(`危险操作待确认 #${id} 超时作废（${entry.toolName}）`);
        }
    }
}

/**
 * 挂起一个写工具调用
 * @returns 待确认 id，队列满时返回 null
 */
export function hold(
    toolCall: ToolCall,
    ctx: { userId?: string; senderName?: string; space?: Space | null },
): string | null {
    sweepExpired();
    if (pending.size >= MAX_PENDING) return null;
    const id = crypto.randomBytes(2).toString("hex");
    const toolName = toolCall.function.name;
    pending.set(id, {
        toolCall,
        toolName,
        requestedBy: ctx?.userId ?? "unknown",
        requestedByName: ctx?.senderName ?? "未知用户",
        space: ctx?.space ?? null,
        createdAt: Date.now(),
    });
    logger.info(`危险操作待确认 #${id}: ${toolName}（发起人 ${ctx?.senderName ?? "?"}）`);
    return id;
}

/**
 * 取出并移除一个挂起的写工具调用
 * @returns 未找到时 entry 为 null
 */
export function take(id: string): { entry: PendingToolCall | null; error: string } {
    sweepExpired();
    const entry = pending.get(id);
    if (!entry) return { entry: null, error: `没有找到待确认操作 #${id}（可能已过期或已执行）` };
    pending.delete(id);
    return { entry, error: "" };
}

/** 列出当前所有挂起项 */
export function list(): string {
    sweepExpired();
    if (pending.size === 0) return "当前没有待确认的危险操作";
    const lines = [...pending.entries()].map(([id, e]) => {
        const age = Math.floor((Date.now() - e.createdAt) / 60000);
        const args = e.toolCall.function.arguments;
        return `#${id} ${e.toolName}（${e.requestedByName} 发起，${age}分钟前） 参数: ${args.slice(0, 200)}`;
    });
    return `待确认列表：\n${lines.join("\n")}`;
}
