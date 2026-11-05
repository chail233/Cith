import { runAgent } from "../agent-runner.ts";
import logger from "../../utils/logger.js";
import { getAgent } from "../../agent/AgentManager.ts";
import {nowTime} from "../../utils/time.js";
import { extractText, compactSegments } from "../../utils/extractText.ts";

/**
 * AI 对话处理器
 * 当消息 @ 机器人时触发
 */


/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
export default async function aiChat(ctx) {
    const message = ctx.message || [];
    const selfMention = message.find((seg) => seg.type === "mention" && seg.data?.isSelf);
    if (ctx.space.from === "group" && !selfMention) return false;

    const compact = compactSegments(message, ctx.imageDescription);
    const msg = {
        role: "user",
        content: {
            name: ctx.senderName,
            id: ctx.userId,
            time: nowTime(),
            ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
            ...(compact.length ? { message: compact } : {}),
        },
    };
    getAgent(ctx.space).memory.add(msg);
    logger.info("AI 对话请求:", extractText(message));

    await runAgent(ctx);

    return true;
}