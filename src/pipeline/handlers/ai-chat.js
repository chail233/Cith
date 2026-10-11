import chatAPI from "../../llm/chat.js";
import logger from "../../utils/logger.js";
import chatrecorder from "../../llm/recorder.js";
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
    if (!ctx.isAtBot) return false;

    const content = ctx.text + (ctx.imageDescription ? `\n${ctx.imageDescription}` : "");
    const msg = {
        role: "user",
        content: {
            name: ctx.senderName,
            qq: ctx.userId,
            time: nowTime(),
            text: content,
            at: "我"
        },
    };
    chatrecorder.add(msg);
    logger.info("AI 对话请求:", content);

    await chatAPI(ctx);

    return true;
}