// @ts-check

import chatAPI from "../../llm/chat.js";
import recorder from "../../llm/recorder.js";
import logger from "../../utils/logger.js";
import config from "../../config.js";
import { nowTime} from "../../utils/time.js";
/**
 * 主动聊天处理器
 * 当群内连续若干条消息无 AI 参与时，主动触发一次对话
 */

/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
export default async function proactiveChat(ctx) {
    if(!config.EnableProactiveChat) return false;
    const text = ctx.text + (ctx.imageDescription ? `\n${ctx.imageDescription}` : "");
    recorder.add({
        role: "user",
        content: {
            name: ctx.senderName,
            qq: ctx.userId,
            time: nowTime(),
            text: text,
        },
    });
    // 检查是否达到主动触发阈值
    if (recorder.msgWithoutChat >= config.PROACTIVE_CHAT_LIMIT) {
        logger.info("达到主动聊天阈值，触发 AI 对话");
        recorder.msgWithoutChat = 0;
        await chatAPI(ctx);
        return true;
    }

    // 未达到阈值
    recorder.msgWithoutChat++;
    return false;
}