/**
 * AI 回复解析
 * 从原 chat.js 的 handleReply 抽离，负责把模型输出解析为动作数组
 */
import logger from "../utils/logger.js";
import type { ReplyAct } from "../types/index.ts";

/**
 * 处理 AI 回复内容
 * 支持三种格式：
 *   1. {action: [...]}  — 预期的标准格式
 *   2. [...]            — AI 直接返回数组
 *   3. 纯文本           — 降级为 text 消息
 */
export function parseReply(content: string | null | undefined): ReplyAct[] {
    if (!content || content.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        logger.error("AI 返回非 JSON 格式:", content);
        return [{ cmd: "text", content: content }];
    }

    // 标准格式：{action: [...]}，逐项守卫校验，过滤模型产生的非法条目
    if (isJsonObject(parsed) && Array.isArray(parsed.action)) {
        return parsed.action.filter(isReplyAct);
    }
    // AI 直接返回数组：[{cmd, content}, ...]
    if (Array.isArray(parsed)) {
        return parsed.filter(isReplyAct);
    }
    // JSON 对象但没有合法 action 字段，降级为文本
    logger.warn("AI 返回 JSON 但格式不匹配:", content);
    return [{ cmd: "text", content: content }];
}

/** 守卫：任意 JSON 对象（非数组） */
function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 守卫：合法的回复动作条目 */
function isReplyAct(value: unknown): value is ReplyAct {
    return isJsonObject(value) && typeof value.cmd === "string" && typeof value.content === "string";
}
