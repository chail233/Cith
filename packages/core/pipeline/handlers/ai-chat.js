import { runAgent } from "../agent-runner.ts";
import logger from "../../utils/logger.js";
import { getAgent } from "../../agent/AgentManager.ts";
import {nowTime} from "../../utils/time.js";


/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
export default async function aiChat(ctx) {
    const message = ctx.message || [];
    const selfMention = message.find((seg) => seg.type === "mention" && seg.data?.isSelf);
    if (ctx.space.from === "group" && !selfMention) return false;

    const msg = {
        role: "user",
        content: {
            name: ctx.senderName,
            id: ctx.userId,
            time: nowTime(),
            ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
            ...(message.length ? { message } : {}),
        },
    };
    getAgent(ctx.space).memory.add(msg);
    logger.debug("AI 对话请求:", message);

    await runAgent(ctx);

    return true;
}