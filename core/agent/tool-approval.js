import crypto from "node:crypto";
import logger from "../utils/logger.js";

const TTL_MS = 10 * 60 * 1000; // 10 分钟
const MAX_PENDING = 20;

/** @type {Map<string, import("./types.ts").PendingToolCall>} */
const pending = new Map();

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
 * @param {object} toolCall 完整的工具调用对象 { id, function: { name, arguments } }
 * @param {{userId?: string, senderName?: string}} ctx
 * @returns {string|null} 待确认 id，队列满时返回 null
 */
export function hold(toolCall, ctx) {
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
 * @param {string} id
 * @returns {{entry: import("./types.ts").PendingToolCall|null, error: string}} 未找到时 entry 为 null
 */
export function take(id) {
    sweepExpired();
    const entry = pending.get(id);
    if (!entry) return { entry: null, error: `没有找到待确认操作 #${id}（可能已过期或已执行）` };
    pending.delete(id);
    return { entry, error: "" };
}

/**
 * 取消一个挂起项
 * @param {string} id
 */
export function cancel(id) {
    if (pending.delete(id)) return `已取消待确认操作 #${id}`;
    return `没有找到待确认操作 #${id}`;
}

/** 列出当前所有挂起项 */
export function list() {
    sweepExpired();
    if (pending.size === 0) return "当前没有待确认的危险操作";
    const lines = [...pending.entries()].map(([id, e]) => {
        const age = Math.floor((Date.now() - e.createdAt) / 60000);
        const args = e.toolCall.function.arguments;
        return `#${id} ${e.toolName}（${e.requestedByName} 发起，${age}分钟前） 参数: ${args.slice(0, 200)}`;
    });
    return `待确认列表：\n${lines.join("\n")}`;
}
