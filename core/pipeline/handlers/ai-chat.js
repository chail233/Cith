import { runAgent } from "../agent-runner.ts";
import logger from "../../utils/logger.js";
import { getAgent } from "../../agent/AgentManager.ts";
import {nowTime} from "../../utils/time.js";
import { extractText } from "../../utils/extractText.ts";

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

    const content = extractText(message) + (ctx.imageDescription ? `\n${ctx.imageDescription}` : "");
    const at = selfMention
        ? "我"
        : (message.find((seg) => seg.type === "mention")?.data?.name ?? null);

    const msg = {
        role: "user",
        content: {
            name: ctx.senderName,
            id: ctx.userId,
            time: nowTime(),
            text: content,
            at,
        },
    };
    getAgent(ctx.space).memory.add(msg);
    logger.info("AI 对话请求:", content);

    await runAgent(ctx);

    return true;
}