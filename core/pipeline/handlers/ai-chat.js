import { runAgent } from "../agent-runner.ts";
import logger from "../../utils/logger.js";
import { getAgent } from "../../agent/AgentManager.ts";
import {nowTime} from "../../utils/time.js";

/**
 * AI 对话处理器
 * 当消息 @ 机器人时触发
 */


/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
export default async function aiChat(ctx) {
    if (ctx.space.from==="group" && ctx.at !== "我") return false;

    const content = ctx.text + (ctx.imageDescription ? `\n${ctx.imageDescription}` : "");
    const msg = {
        role: "user",
        content: {
            name: ctx.senderName,
            id: ctx.userId,
            time: nowTime(),
            text: content,
            at: ctx.at
        },
    };
    getAgent(ctx.space).memory.add(msg);
    logger.info("AI 对话请求:", content);

    await runAgent(ctx);

    return true;
}