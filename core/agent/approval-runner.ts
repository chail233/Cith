/**
 * 门禁危险操作的确认执行链
 * 从 tool-approval 队列取出挂起项 → 以目标会话 Agent 的身份执行工具 → 结果回填记忆。
 */
import { take } from "./tool-approval.js";
import { callTool } from "./tools.js";
import { getAgent } from "./AgentManager.ts";
import logger from "../utils/logger.js";
import type { Context } from "../types/index.ts";

/**
 * 确认并执行一个挂起的写工具调用
 * 执行结果回填发起会话的 Agent 记忆，由后续 LLM 请求注入上下文
 * @param id 待确认操作编号
 * @param ctx 当前命令上下文（确认发起人）
 */
export async function confirmPending(id: string, ctx: Context): Promise<{ ok: boolean; text: string }> {
    const { entry, error } = take(id);
    if (!entry) return { ok: false, text: error };
    logger.info(`执行已确认的危险操作 #${id}: ${entry.toolName}`);
    const toolCall = entry.toolCall;
    try {
        // 结果注入发起会话的上下文；会话已被回收时按发起空间重建
        const target = getAgent(entry.space ?? ctx.space);
        const result = await callTool(toolCall, { ...ctx, space: entry.space ?? ctx.space, agent: target }, true);
        target.recordToolCall(entry.toolName, toolCall.function.arguments, result);
        return { ok: true, text: `#${id} ${entry.toolName} 已执行，结果已注入对话上下文` };
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { ok: false, text: `#${id} ${entry.toolName} 执行失败：${detail}` };
    }
}
