import crypto from "node:crypto";
import logger from "../utils/logger.js";
import { callTool } from "./tools.js";
import { getRecorder } from "./session.ts";

const TTL_MS = 10 * 60 * 1000; // 10 分钟
const MAX_PENDING = 20;

/** @type {Map<string, {toolCall: object, toolName: string, requestedBy: string, requestedByName: string, space: object|null, createdAt: number}>} */
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
 * 确认并执行一个挂起的写工具调用
 * 执行结果直接写入 recorder，由后续 chat() 注入 LLM 上下文
 * @param {string} id
 * @returns {Promise<{ok: boolean, text: string}>} text 包含执行状态摘要；未找到时 ok=false
 */
export async function confirm(id) {
    sweepExpired();
    const entry = pending.get(id);
    if (!entry) return { ok: false, text: `没有找到待确认操作 #${id}（可能已过期或已执行）`};
    pending.delete(id);
    logger.info(`执行已确认的危险操作 #${id}: ${entry.toolName}`);
    try {
        const toolCall = entry.toolCall;
        const result = await callTool(toolCall, entry.space ? { space: entry.space } : null, true);
        // 结果注入发起会话的上下文；会话已被回收时按发起空间重建
        if (entry.space) {
            getRecorder(entry.space).add({ role: "tool", content: { text: result }, tool_call_id: toolCall.id });
        }
        return { ok: true, text: `#${id} ${entry.toolName} 已执行，结果已注入对话上下文`};
    } 
    catch (err) {
        return { ok: false, text: `#${id} ${entry.toolName} 执行失败：${err.message}`};
    }
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
