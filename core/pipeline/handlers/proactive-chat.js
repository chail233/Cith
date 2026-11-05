import { runAgent } from "../agent-runner.ts";
import { getAgent } from "../../agent/AgentManager.ts";
import logger from "../../utils/logger.js";
import config from "../../config.js";
import { nowTime} from "../../utils/time.js";
import { extractText } from "../../utils/extractText.ts";
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

    const message = ctx.message || [];
    const selfMention = message.find((seg) => seg.type === "mention" && seg.data?.isSelf);
    const at = selfMention
        ? "我"
        : (message.find((seg) => seg.type === "mention")?.data?.name ?? null);

    const recorder = getAgent(ctx.space).memory;
    const text = extractText(message) + (ctx.imageDescription ? `\n${ctx.imageDescription}` : "");
    recorder.add({
        role: "user",
        content: {
            name: ctx.senderName,
            id: ctx.userId,
            time: nowTime(),
            text: text,
            //有at时写入字段
            ...(at ? { at } : {}),
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