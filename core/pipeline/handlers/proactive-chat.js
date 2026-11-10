import { runAgent } from "../agent-runner.ts";
import { getAgent } from "../../agent/AgentManager.ts";
import logger from "../../utils/logger.js";
import config from "../../config.js";
import { nowTime} from "../../utils/time.js";
/**
 * 主动聊天处理器
 * 当群内连续若干条消息无 AI 参与时，主动触发一次对话
 */

/**
 * @param {import("../../types/index.ts").Context} ctx
 * @returns {Promise<boolean>}
 */
export default async function proactiveChat(ctx) {
    if(!config.enableProactiveChat) return false;
    const limit = config.proactiveChatLimit;
    if (!Number.isFinite(limit) || limit <= 0) return false;

    const recorder = getAgent(ctx.space).memory;
    const message = ctx.message || [];
    recorder.add({
        role: "user",
        content: {
            name: ctx.senderName,
            id: ctx.userId,
            time: nowTime(),
            // 空字段不写入
            ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
            ...(message.length ? { message } : {}),
        },
    });

    recorder.msgWithoutChat++;
    if (recorder.msgWithoutChat < limit) return false;

    if (recorder.isRequesting) return false;

    logger.info(`达到主动聊天阈值（${recorder.msgWithoutChat} 条），触发 AI 对话`);
    recorder.msgWithoutChat = 0;
    await runAgent(ctx);
    return true;
}